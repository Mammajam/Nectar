import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { backoffDelay, sleep } from '../util/backoff.js';
import { parseSse } from './sse.js';
import { classifyEvent, type BeeEvent } from './types.js';

export interface StreamHandlers {
  onEvent: (event: BeeEvent) => void | Promise<void>;
  onStatus?: (status: 'connecting' | 'connected' | 'disconnected', detail?: string) => void;
  onError?: (err: unknown) => void;
}

export interface StreamSource {
  start(handlers: StreamHandlers): void;
  stop(): Promise<void>;
}

/** Shared reconnect loop: run `connectOnce` until stopped, backing off after failures. */
abstract class ReconnectingSource implements StreamSource {
  protected stopped = false;
  private loop: Promise<void> | null = null;

  start(handlers: StreamHandlers): void {
    if (this.loop) throw new Error('stream already started');
    this.stopped = false;
    this.loop = (async () => {
      let attempt = 0;
      while (!this.stopped) {
        handlers.onStatus?.('connecting');
        const startedAt = Date.now();
        try {
          await this.connectOnce(handlers);
        } catch (err) {
          if (!this.stopped) handlers.onError?.(err);
        }
        if (this.stopped) break;
        handlers.onStatus?.('disconnected');
        // A connection that lived > 60s resets the backoff.
        attempt = Date.now() - startedAt > 60_000 ? 0 : attempt + 1;
        await sleep(backoffDelay(attempt, this.baseDelayMs));
      }
    })();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.abort();
    await this.loop;
    this.loop = null;
  }

  protected baseDelayMs = 1000;
  protected abstract connectOnce(handlers: StreamHandlers): Promise<void>;
  protected abstract abort(): void;
}

/** Live events from the proxy's SSE endpoint: GET /v1/stream?types=... */
export class SseStreamSource extends ReconnectingSource {
  private controller: AbortController | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly types: string[],
    private readonly fetchImpl: typeof fetch = fetch,
    baseDelayMs = 1000,
  ) {
    super();
    this.baseDelayMs = baseDelayMs;
  }

  protected async connectOnce(h: StreamHandlers): Promise<void> {
    this.controller = new AbortController();
    const url = new URL('/v1/stream', this.baseUrl);
    if (this.types.length) url.searchParams.set('types', this.types.join(','));
    const res = await this.fetchImpl(url, {
      headers: { accept: 'text/event-stream' },
      signal: this.controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`);
    h.onStatus?.('connected');
    for await (const msg of parseSse(res.body as unknown as AsyncIterable<Uint8Array>)) {
      let payload: unknown = msg.data;
      try {
        payload = JSON.parse(msg.data);
      } catch {
        /* keep raw string */
      }
      await h.onEvent(classifyEvent(payload, msg.event));
    }
  }

  protected abort(): void {
    this.controller?.abort();
  }
}

export type SpawnFn = (cmd: string, args: string[]) => ChildProcess;

const defaultSpawn: SpawnFn = (cmd, args) => nodeSpawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });

/** Live events from `bee stream --json` (one JSON object per line). */
export class CliStreamSource extends ReconnectingSource {
  private child: ChildProcess | null = null;
  private readonly spawn: SpawnFn;
  private readonly killGroup: boolean;

  /**
   * `bee` is a wrapper that starts the real stream process, so signalling only the
   * wrapper leaves the stream orphaned with its pipe open. The default spawn puts the
   * child in its own process group and `abort` signals the whole group.
   */
  constructor(
    private readonly beeBin: string,
    private readonly types: string[],
    spawn?: SpawnFn,
    baseDelayMs = 1000,
    killGroup = spawn === undefined && process.platform !== 'win32',
  ) {
    super();
    this.spawn = spawn ?? defaultSpawn;
    this.killGroup = killGroup;
    this.baseDelayMs = baseDelayMs;
  }

  protected connectOnce(h: StreamHandlers): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = ['stream', '--json'];
      if (this.types.length) args.push('--types', this.types.join(','));
      const child = this.spawn(this.beeBin, args);
      this.child = child;
      let stderr = '';
      child.stderr?.on('data', (d: Buffer) => {
        stderr = (stderr + d.toString()).slice(-2000);
      });
      child.once('error', reject);
      const rl = createInterface({ input: child.stdout! });
      let announced = false;
      let queue = Promise.resolve();
      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (!announced) {
          announced = true;
          h.onStatus?.('connected');
        }
        let payload: unknown;
        try {
          payload = JSON.parse(trimmed);
        } catch {
          h.onError?.(new Error(`non-JSON line from bee stream: ${trimmed.slice(0, 120)}`));
          return;
        }
        // Keep handler calls in order even when they are async.
        queue = queue.then(() => h.onEvent(classifyEvent(payload))).catch((e) => h.onError?.(e));
      });
      child.once('close', (code) => {
        rl.close();
        queue.then(() => {
          if (code === 0 || this.stopped) resolve();
          else reject(new Error(`bee stream exited with ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
        });
      });
    });
  }

  protected abort(): void {
    const child = this.child;
    if (!child) return;
    try {
      if (this.killGroup && child.pid) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {
      child.kill('SIGTERM'); // group already gone
    }
  }
}
