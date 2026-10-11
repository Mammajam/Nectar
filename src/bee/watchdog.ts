import { ensureProxy, isUp, type ProxyHandle } from './proxy.js';

/**
 * Keeps `bee proxy` alive for the life of Nectar: if the proxy stops
 * answering, it is restarted on the same port (so the client URL never changes).
 */
export class ProxyWatchdog {
  private failures = 0;

  constructor(
    private handle: ProxyHandle,
    private readonly beeBin: string,
    private readonly port: number,
    private readonly deps: { isUp?: typeof isUp; ensure?: typeof ensureProxy } = {},
  ) {}

  get current(): ProxyHandle {
    return this.handle;
  }

  /** Returns 'ok', 'restarted' or 'down'. */
  async check(): Promise<'ok' | 'restarted' | 'down'> {
    const up = await (this.deps.isUp ?? isUp)(this.handle.url, fetch);
    if (up) {
      this.failures = 0;
      return 'ok';
    }
    this.failures++;
    try {
      this.handle.stop();
      this.handle = await (this.deps.ensure ?? ensureProxy)(this.beeBin, this.port);
      this.failures = 0;
      return 'restarted';
    } catch {
      return 'down';
    }
  }

  stop(): void {
    this.handle.stop();
  }
}
