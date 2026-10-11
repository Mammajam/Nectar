/**
 * Phase 0 gate check. Run on your Mac after `bee login`:
 *   npm run check:g0                  read-only checks
 *   npm run check:g0 -- --stream 60   also listen 60 s and talk near your watch
 *   npm run check:g0 -- --alarm       also create a test todo with an alarm 5 min ahead
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BeeClient } from '../src/bee/client.js';
import { ensureProxy } from '../src/bee/proxy.js';
import { CliStreamSource } from '../src/bee/stream.js';
import { loadConfig } from '../src/config.js';
import { loadDotEnv } from '../src/env.js';

const run = promisify(execFile);
const args = process.argv.slice(2);
const streamIdx = args.indexOf('--stream');
const streamSeconds = streamIdx >= 0 ? Number(args[streamIdx + 1] ?? 60) : 0;
const wantAlarm = args.includes('--alarm');

const results: { name: string; ok: boolean; detail: string }[] = [];
const record = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} - ${detail}`);
};

async function main() {
  loadDotEnv();
  const config = loadConfig();

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
    record('Bee login', false, 'run: bee login (unlock Developer Mode in the Bee iOS app first)');
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
    console.log(`\nListening ${streamSeconds}s on bee stream. Talk near your watch...`);
    let utterances = 0;
    const lags: number[] = [];
    const source = new CliStreamSource(config.beeBin, ['new-utterance']);
    source.start({
      onEvent: (e) => {
        if (e.kind !== 'utterance') return;
        utterances++;
        console.log(`      heard: ${e.utterance.text}`);
        const t = Number(e.utterance.start ?? e.raw.timestamp ?? NaN);
        if (Number.isFinite(t) && t > 1e12) lags.push(Date.now() - t);
      },
      onError: (err) => console.log(`      stream error: ${err instanceof Error ? err.message : String(err)}`),
    });
    await new Promise((r) => setTimeout(r, streamSeconds * 1000));
    await source.stop();
    const lag = lags.length ? `${Math.round(lags.reduce((a, b) => a + b, 0) / lags.length / 1000)} s avg lag` : 'lag unknown';
    record('Live utterances', utterances > 0, `${utterances} heard, ${lag}`);
  }

  proxy.stop();
}

main()
  .catch((e) => record('Unexpected error', false, e instanceof Error ? e.message : String(e)))
  .finally(() => {
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\nG0: ${results.length - failed}/${results.length} checks passed.`);
    console.log('Log anything that went wrong in FRICTION_LOG.md.');
    console.log('Still to do by hand: Bedrock Anthropic use-case form + one Converse call.');
    process.exit(failed ? 1 : 0);
  });
