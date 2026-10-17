import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { CliStreamSource, SseStreamSource } from '../src/bee/stream.js';
import type { BeeEvent } from '../src/bee/types.js';

function fakeChild(lines: string[], exitCode = 0) {
  const child = new EventEmitter() as ChildProcess & EventEmitter;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.assign(child, { stdout, stderr, kill: () => true });
  setTimeout(() => {
    for (const l of lines) stdout.write(`${l}\n`);
    stdout.end();
    setTimeout(() => child.emit('close', exitCode), 5);
  }, 5);
  return child;
}

describe('CliStreamSource', () => {
  it('spawns bee stream --json with types and emits classified events in order', async () => {
    const calls: string[][] = [];
    const events: BeeEvent[] = [];
    const src = new CliStreamSource(
      'bee',
      ['new-utterance'],
      (cmd, args) => {
        calls.push([cmd, ...args]);
        return fakeChild(['{"utterance":{"text":"one"}}', 'not json', '{"utterance":{"text":"two"}}']);
      },
      10,
    );
    const errors: unknown[] = [];
    src.start({ onEvent: (e) => void events.push(e), onError: (e) => void errors.push(e) });
    await new Promise((r) => setTimeout(r, 60));
    await src.stop();
    expect(calls[0]).toEqual(['bee', 'stream', '--json', '--types', 'new-utterance']);
    const texts = events.flatMap((e) => (e.kind === 'utterance' ? [e.utterance.text] : []));
    expect(texts.slice(0, 2)).toEqual(['one', 'two']);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it('stops by signalling the whole process group, so the real stream process is not orphaned', async () => {
    const killed: [number, string | number | undefined][] = [];
    const spy = vi.spyOn(process, 'kill').mockImplementation(((pid: number, sig?: string | number) => {
      killed.push([pid, sig]);
      return true;
    }) as typeof process.kill);
    try {
      const child = new EventEmitter() as ChildProcess & EventEmitter;
      Object.assign(child, { pid: 4242, stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
      const src = new CliStreamSource('bee', [], () => child, 5, true);
      src.start({ onEvent: () => {} });
      await new Promise((r) => setTimeout(r, 20));
      const stopping = src.stop();
      child.emit('close', null); // the group's exit closes the pipes
      await stopping;
      expect(killed).toContainEqual([-4242, 'SIGTERM']);
    } finally {
      spy.mockRestore();
    }
  });

  it('reconnects after the process exits with an error', async () => {
    let spawns = 0;
    const src = new CliStreamSource('bee', [], () => {
      spawns++;
      return fakeChild([], 1);
    }, 5);
    src.start({ onEvent: () => {}, onError: () => {} });
    await new Promise((r) => setTimeout(r, 120));
    await src.stop();
    expect(spawns).toBeGreaterThanOrEqual(2);
  });
});

describe('SseStreamSource', () => {
  it('reads SSE from /v1/stream and passes the event name as a hint', async () => {
    const urls: string[] = [];
    const body = 'event: journal-text\ndata: {"text":"done with the invoice"}\n\n';
    const fetchImpl = (async (url: URL) => {
      urls.push(String(url));
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as unknown as typeof fetch;
    const events: BeeEvent[] = [];
    const src = new SseStreamSource('http://127.0.0.1:8787', ['journal-text'], fetchImpl, 10);
    src.start({ onEvent: (e) => void events.push(e) });
    await new Promise((r) => setTimeout(r, 30));
    await src.stop();
    expect(urls[0]).toBe('http://127.0.0.1:8787/v1/stream?types=journal-text');
    expect(events[0]).toMatchObject({ kind: 'journal', text: 'done with the invoice' });
  });
});
