import { CloseOutHandler } from './actions/closeout.js';
import { describeReview, describeScheduled } from './actions/report.js';
import { EveningReview, REVIEW_LAST_KEY, reviewDue } from './actions/review.js';
import { TodoScheduler } from './actions/scheduler.js';
import { BedrockStructuredLlm } from './ai/bedrock.js';
import { BeeCli } from './bee/cli.js';
import { createContextProvider, type ContextProvider } from './ai/context.js';
import { CommitmentExtractor } from './ai/extractor.js';
import { UtteranceWindower } from './ai/windowing.js';
import { BeeClient } from './bee/client.js';
import { ensureProxy } from './bee/proxy.js';
import { CliStreamSource, SseStreamSource, type StreamSource } from './bee/stream.js';
import { catchUp } from './bee/sync.js';
import type { BeeEvent } from './bee/types.js';
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

async function main() {
  loadDotEnv();
  const config = loadConfig();
  const store = new Store(config.dbPath);
  log.info(`Nectar starting (stream: ${config.streamMode}, db: ${config.dbPath})`);

  const proxy = await ensureProxy(config.beeBin, config.proxyPort);
  log.info(`Bee proxy ${proxy.owned ? 'started' : 'found'} at ${proxy.url}`);
  const client = new BeeClient(proxy.url);

  const me = await client.me();
  log.info(`Signed in to Bee${typeof me?.name === 'string' ? ` as ${me.name}` : ''}`);

  // Phase 3: actions on the wrist ----------------------------------------------
  const scheduler = config.createTodos
    ? new TodoScheduler(client, new BeeCli(config.beeBin), store, {
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
  const review = new EveningReview(client, store, {
    timezone: config.timezone,
    workdayStartHour: config.workdayStartHour,
    leadMs: config.alarmLeadMs,
    notify: config.createTodos,
  });
  if (!config.createTodos) log.info('To-do creation off (NECTAR_CREATE_TODOS=off): commitments are stored only');
  scheduleNow(); // anything left from a previous run

  // Phase 2: commitment extraction ------------------------------------------
  let pipeline: CommitmentPipeline | null = null;
  let context: ContextProvider | null = null;
  let ticker: NodeJS.Timeout | null = null;
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
    ticker = setInterval(() => pipeline?.tick(), 2000);
  } else {
    log.info('Extraction off (NECTAR_EXTRACTION=off): storing events only');
  }

  // Catch up on anything missed while offline; new utterances go to the extractor too.
  try {
    const r = await catchUp(client, store, (e) => pipeline?.onEvent(e));
    log.info(`Catch-up: ${r.changesSeen} changes, ${r.conversationsFetched} conversations, ${r.newUtterances} new utterances`);
  } catch (err) {
    log.warn(`Catch-up skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  const source: StreamSource =
    config.streamMode === 'sse'
      ? new SseStreamSource(proxy.url, config.streamTypes)
      : new CliStreamSource(config.beeBin, config.streamTypes);

  source.start({
    onStatus: (s, d) => log.info(`stream ${s}${d ? `: ${d}` : ''}`),
    onError: (err) => log.error('stream error', err),
    onEvent: (event) => {
      const isNew = store.insertEvent(event);
      if (isNew || event.kind === 'connected') log.info(describe(event));
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

  let reviewing = false;
  const reviewTicker = config.reviewTime
    ? setInterval(() => {
        if (reviewing || !reviewDue(new Date(), config.reviewTime!, config.timezone, store.get(REVIEW_LAST_KEY))) return;
        reviewing = true;
        review
          .run()
          .then((r) => describeReview(r).forEach((l) => log.info(l)))
          .catch((err) => log.error('evening review failed', err))
          .finally(() => (reviewing = false));
      }, 60_000)
    : null;
  if (config.reviewTime) log.info(`Evening review at ${config.reviewTime} (${config.timezone})`);

  const shutdown = async () => {
    log.info('Shutting down...');
    if (ticker) clearInterval(ticker);
    if (reviewTicker) clearInterval(reviewTicker);
    await source.stop();
    await pipeline?.drain();
    await context?.close().catch(() => {});
    proxy.stop();
    store.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error('Fatal', err);
  process.exit(1);
});
