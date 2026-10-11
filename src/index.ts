import { CloseOutHandler } from './actions/closeout.js';
import { RecapScheduler } from './actions/recap.js';
import { describeReview, describeScheduled } from './actions/report.js';
import { EveningReview, REVIEW_LAST_KEY, reviewDue } from './actions/review.js';
import { TodoScheduler } from './actions/scheduler.js';
import { BedrockStructuredLlm } from './ai/bedrock.js';
import { createContextProvider, type ContextProvider } from './ai/context.js';
import { CommitmentExtractor } from './ai/extractor.js';
import { UtteranceWindower } from './ai/windowing.js';
import { BeeCli } from './bee/cli.js';
import { BeeClient } from './bee/client.js';
import { ensureProxy } from './bee/proxy.js';
import { CliStreamSource, SseStreamSource, type StreamSource } from './bee/stream.js';
import { catchUp } from './bee/sync.js';
import type { BeeEvent } from './bee/types.js';
import { ProxyWatchdog } from './bee/watchdog.js';
import { loadConfig } from './config.js';
import { loadDotEnv } from './env.js';
import { CommitmentPipeline } from './pipeline.js';
import { Store } from './store/db.js';
import { log } from './util/log.js';

function describe(e: BeeEvent): string {
  switch (e.kind) {
    case 'utterance':
      return `[utterance] conv ${e.conversationId ?? '?'}: ${e.utterance.speaker ? `${e.utterance.speaker}: ` : ''}${e.utterance.text}`;
    case 'conversation':
      return `[conversation] ${e.conversation.id} ${e.conversation.title ?? ''}`.trim();
    case 'todo':
      return `[todo] ${e.todo.id} ${e.todo.completed ? '(done) ' : ''}${e.todo.text}`;
    case 'journal':
      return `[journal] ${e.text ?? ''}`;
    case 'connected':
      return '[connected]';
    case 'unknown':
      return `[unknown${e.name ? ` ${e.name}` : ''}] ${JSON.stringify(e.raw).slice(0, 160)}`;
  }
}

/** Run `fn` every `ms`, never overlapping itself, logging failures. */
function every(ms: number, name: string, fn: () => Promise<void>): NodeJS.Timeout {
  let busy = false;
  return setInterval(() => {
    if (busy) return;
    busy = true;
    fn()
      .catch((err) => log.error(`${name} failed`, err))
      .finally(() => (busy = false));
  }, ms);
}

async function main() {
  loadDotEnv();
  const config = loadConfig();
  const store = new Store(config.dbPath);
  const timers: NodeJS.Timeout[] = [];
  log.info(`Nectar starting (stream: ${config.streamMode}, db: ${config.dbPath})`);

  const watchdog = new ProxyWatchdog(await ensureProxy(config.beeBin, config.proxyPort), config.beeBin, config.proxyPort);
  log.info(`Bee proxy ${watchdog.current.owned ? 'started' : 'found'} at ${watchdog.current.url}`);
  const client = new BeeClient(watchdog.current.url);
  const cli = new BeeCli(config.beeBin);

  const me = await client.me();
  log.info(`Signed in to Bee${typeof me?.name === 'string' ? ` as ${me.name}` : ''}`);

  // Phase 3: actions on the wrist ---------------------------------------------
  const scheduler = config.createTodos
    ? new TodoScheduler(client, cli, store, {
        timezone: config.timezone,
        leadMs: config.alarmLeadMs,
        workdayStartHour: config.workdayStartHour,
        sameDayCutoffHour: config.sameDayCutoffHour,
      })
    : null;
  const scheduleNow = () => {
    scheduler
      ?.scheduleAll()
      .then((results) => results.forEach((r) => log.info(describeScheduled(r, new Date(), config.timezone))))
      .catch((err) => log.error('scheduling failed', err));
  };
  const closeOut = new CloseOutHandler(client, store);
  if (!config.createTodos) log.info('To-do creation off (NECTAR_CREATE_TODOS=off): commitments are stored only');
  scheduleNow(); // anything left from a previous run

  // Phase 2: commitment extraction ------------------------------------------
  let pipeline: CommitmentPipeline | null = null;
  let context: ContextProvider | null = null;
  if (config.extractionEnabled) {
    const created = await createContextProvider(config.beeBin, client);
    context = created.provider;
    log.info(`Context from Bee ${created.via === 'mcp' ? 'MCP server' : 'REST API (MCP unavailable)'}; model ${config.modelId}`);
    const extractor = new CommitmentExtractor(new BedrockStructuredLlm(config.modelId, { region: config.awsRegion }), {
      timezone: config.timezone,
      minConfidence: config.minConfidence,
    });
    pipeline = new CommitmentPipeline(new UtteranceWindower({ pauseMs: config.windowPauseMs }), extractor, context, store, {
      openThreshold: config.openThreshold,
      onResult: ({ window, saved, skippedDuplicates }) => {
        if (saved.length === 0) {
          log.info(`analyzed conv ${window.conversationId} (${window.utterances.length} lines): no new commitments${skippedDuplicates ? `, ${skippedDuplicates} duplicate` : ''}`);
        }
        for (const s of saved) {
          const c = s.commitment;
          log.info(
            `[commitment ${s.status}] ${c.what}${c.who ? ` -> ${c.who}` : ''}${c.dueAt ? ` | due ${c.dueAt}` : ''} (${Math.round(c.confidence * 100)}%)`,
          );
        }
        if (saved.some((s) => s.status === 'open')) scheduleNow();
      },
      onError: (err, window) => log.error(`extraction failed for conv ${window.conversationId}`, err),
    });
    timers.push(setInterval(() => pipeline?.tick(), 2000));
  } else {
    log.info('Extraction off (NECTAR_EXTRACTION=off): storing events only');
  }

  // Catch-up now and on a timer; the live stream is at-most-once.
  const runCatchUp = async (label: string) => {
    const r = await catchUp(client, store, (e) => pipeline?.onEvent(e));
    if (label === 'startup' || r.newUtterances > 0) {
      log.info(`Catch-up (${label}): ${r.changesSeen} changes, ${r.conversationsFetched} conversations, ${r.newUtterances} new utterances`);
    }
  };
  await runCatchUp('startup').catch((err) => log.warn(`Catch-up skipped: ${err instanceof Error ? err.message : String(err)}`));
  timers.push(every(config.catchUpIntervalMs, 'catch-up', () => runCatchUp('periodic')));

  // Live stream ---------------------------------------------------------------
  const source: StreamSource =
    config.streamMode === 'sse'
      ? new SseStreamSource(watchdog.current.url, config.streamTypes)
      : new CliStreamSource(config.beeBin, config.streamTypes);

  source.start({
    onStatus: (s, d) => (s === 'connected' ? log.info('stream connected') : log.debug(`stream ${s}${d ? `: ${d}` : ''}`)),
    onError: (err) => log.error('stream error', err),
    onEvent: (event) => {
      const isNew = store.insertEvent(event);
      if (isNew) log.info(describe(event));
      if (!isNew) return;
      pipeline?.onEvent(event);
      if (event.kind === 'journal' || event.kind === 'todo') {
        closeOut
          .handle(event)
          .then((r) => r && log.info(`[done via ${r.via}] ${r.commitment.what}${r.phrase ? ` ("${r.phrase}")` : ''}`))
          .catch((err) => log.error('close-out failed', err));
      }
    },
  });

  // Proxy watchdog --------------------------------------------------------------
  timers.push(
    every(60_000, 'proxy check', async () => {
      const state = await watchdog.check();
      if (state === 'restarted') log.warn('Bee proxy stopped answering; restarted it');
      if (state === 'down') log.error('Bee proxy is down and could not be restarted', new Error('run `bee status` to check your login'));
    }),
  );

  // F4 evening review -----------------------------------------------------------
  if (config.reviewTime) {
    const review = new EveningReview(client, store, {
      timezone: config.timezone,
      workdayStartHour: config.workdayStartHour,
      leadMs: config.alarmLeadMs,
      notify: config.createTodos,
    });
    timers.push(
      every(60_000, 'evening review', async () => {
        if (!reviewDue(new Date(), config.reviewTime!, config.timezone, store.get(REVIEW_LAST_KEY))) return;
        describeReview(await review.run()).forEach((l) => log.info(l));
      }),
    );
    log.info(`Evening review at ${config.reviewTime} (${config.timezone})`);
  }

  // F3 pre-meeting recap -------------------------------------------------------
  if (config.recapEnabled && config.createTodos) {
    const recap = new RecapScheduler(() => cli.today(), client, store, { timezone: config.timezone, leadMs: config.recapLeadMs });
    timers.push(
      every(60_000, 'pre-meeting recap', async () => {
        for (const r of await recap.tick()) log.info(`[recap] "${r.text}" before ${r.event.title}`);
      }),
    );
    log.info(`Pre-meeting recaps ${Math.round(config.recapLeadMs / 60_000)} min before calendar events`);
  }

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log.info('Shutting down...');
    timers.forEach((t) => clearInterval(t));
    await source.stop();
    await pipeline?.drain();
    await context?.close().catch(() => {});
    watchdog.stop();
    store.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.on('unhandledRejection', (err) => log.error('unexpected error', err));
}

main().catch((err) => {
  log.error('Fatal', err);
  process.exit(1);
});
