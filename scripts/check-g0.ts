/**
 * Phase 0 gate check. Run on your Mac after `bee login`:
 *   npm run check:g0                  read-only checks
 *   npm run check:g0 -- --stream 60   also listen 60 s: say a sentence, press Enter, and it times the lag
 *   npm run check:g0 -- --alarm       also create a test todo with an alarm 5 min ahead
 *   npm run check:g0 -- --bedrock     also make one Bedrock call with NECTAR_MODEL_ID
 */
import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { BedrockStructuredLlm } from '../src/ai/bedrock.js';
import { BeeClient } from '../src/bee/client.js';
import { ensureProxy } from '../src/bee/proxy.js';
import { CliStreamSource } from '../src/bee/stream.js';
import { loadConfig } from '../src/config.js';
import { loadDotEnv } from '../src/env.js';
import { LagMeter } from '../src/util/lag.js';

const run = promisify(execFile);
const args = process.argv.slice(2);
const streamIdx = args.indexOf('--stream');
const streamSeconds = streamIdx >= 0 ? Number(args[streamIdx + 1] ?? 60) : 0;
const wantAlarm = args.includes('--alarm');
const wantBedrock = args.includes('--bedrock');

const results: { name: string; ok: boolean; detail: string }[] = [];
const record = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} - ${detail}`);
};

async function main() {
  loadDotEnv();
  const config = loadConfig();

  if (wantBedrock) {
    try {
      const llm = new BedrockStructuredLlm(config.modelId, { region: config.awsRegion, maxRetries: 1 });
      const t0 = Date.now();
      const out = await llm.structured({
        system: 'You are a test.',
        user: 'Call the tool with ok=true.',
        tool: { name: 'ping', description: 'Health check', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } },
        maxTokens: 50,
      });
      record('Bedrock model call', true, `${config.modelId} answered ${JSON.stringify(out)} in ${Date.now() - t0} ms`);
    } catch (e) {
      const name = (e as { name?: string }).name ?? 'Error';
      record('Bedrock model call', false, `${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  try {
    const { stdout } = await run(config.beeBin, ['version']);
    record('Bee CLI installed', true, stdout.trim());
  } catch {
    record('Bee CLI installed', false, 'run: npm i -g @beeai/cli');
    return;
  }

  try {
    const { stdout } = await run(config.beeBin, ['status']);
    record('Bee login', true, stdout.trim().split('\n')[0] ?? 'ok');
  } catch (e) {
    record('Bee login', false, 'update the Bee iOS app, Settings > tap Version 5 times, then run `bee login` and `bee status`; if still not authenticated, update the app and repeat');
    return;
  }

  let proxy;
  try {
    proxy = await ensureProxy(config.beeBin, config.proxyPort);
    record('Bee API proxy', true, proxy.url);
  } catch (e) {
    record('Bee API proxy', false, e instanceof Error ? e.message : String(e));
    return;
  }
  const client = new BeeClient(proxy.url);

  try {
    const convs = await client.listConversations({ limit: 5 });
    record('Recent conversations', convs.items.length > 0, `${convs.items.length} returned (record something on the watch if 0)`);
    console.log('      sample shape:', JSON.stringify(convs.raw).slice(0, 300));
  } catch (e) {
    record('Recent conversations', false, e instanceof Error ? e.message : String(e));
  }

  try {
    const ch = await client.changes();
    record('Changefeed', true, `${ch.changes.length} changes, cursor ${ch.cursor ? 'present' : 'missing'}`);
    console.log('      sample shape:', JSON.stringify(ch.raw).slice(0, 300));
  } catch (e) {
    record('Changefeed', false, e instanceof Error ? e.message : String(e));
  }

  if (wantAlarm) {
    try {
      const at = new Date(Date.now() + 5 * 60_000);
      const todo = await client.createTodo({ text: 'Nectar G0 test alarm', alarmAt: at });
      record('Write todo with alarm', true, `todo ${todo.id} at ${at.toLocaleTimeString()}; check your watch`);
    } catch (e) {
      record('Write todo with alarm', false, e instanceof Error ? e.message : String(e));
    }
  }

  if (streamSeconds > 0) {
    console.log(`\nListening ${streamSeconds}s on bee stream. Say a sentence near your watch, then press Enter.`);
    console.log('      (Stream utterances have no timestamp, so lag is timed from your Enter key.)');
    let utterances = 0;
    let withUuid = 0;
    const lag = new LagMeter();
    const rl = process.stdin.isTTY ? createInterface({ input: process.stdin }) : null;
    rl?.on('line', () => lag.press());
    const source = new CliStreamSource(config.beeBin, ['new-utterance']);
    source.start({
      onEvent: (e) => {
        if (e.kind !== 'utterance') return;
        utterances++;
        if (typeof e.raw.conversation_uuid === 'string') withUuid++;
        const ms = lag.heard();
        console.log(`      heard: ${e.utterance.text}${ms !== null ? ` (${(ms / 1000).toFixed(1)} s after Enter)` : ''}`);
      },
      onError: (err) => console.log(`      stream error: ${err instanceof Error ? err.message : String(err)}`),
    });
    await new Promise((r) => setTimeout(r, streamSeconds * 1000));
    await source.stop();
    rl?.close();
    const timing = rl ? lag.summary() : 'lag not measured (stdin is not interactive)';
    record('Live utterances', utterances > 0, `${utterances} heard, ${timing}`);
    if (utterances > 0) {
      record('Utterances carry conversation_uuid', withUuid === utterances, `${withUuid} of ${utterances}`);
    }
  }

  proxy.stop();
}

main()
  .catch((e) => record('Unexpected error', false, e instanceof Error ? e.message : String(e)))
  .finally(() => {
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\nG0: ${results.length - failed}/${results.length} checks passed.`);
    console.log('Log anything that went wrong in FRICTION_LOG.md.');
    if (!wantBedrock) console.log('Bedrock not checked: add --bedrock to test model access.');
    process.exit(failed ? 1 : 0);
  });
