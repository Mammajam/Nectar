import { describe, expect, it } from 'vitest';
import { ProxyWatchdog } from '../src/bee/watchdog.js';

const handle = (url = 'http://127.0.0.1:8787') => {
  const h = { url, owned: true, stopped: 0, stop() { h.stopped++; } };
  return h;
};

describe('ProxyWatchdog', () => {
  it('does nothing while the proxy answers', async () => {
    const h = handle();
    const w = new ProxyWatchdog(h, 'bee', 8787, { isUp: async () => true });
    expect(await w.check()).toBe('ok');
    expect(h.stopped).toBe(0);
  });

  it('restarts a dead proxy on the same port', async () => {
    const old = handle();
    const fresh = handle();
    const ports: number[] = [];
    const w = new ProxyWatchdog(old, 'bee', 8787, {
      isUp: async () => false,
      ensure: async (_bin, port) => (ports.push(port), fresh),
    });
    expect(await w.check()).toBe('restarted');
    expect(old.stopped).toBe(1);
    expect(ports).toEqual([8787]);
    expect(w.current).toBe(fresh);
  });

  it('reports down when restart fails', async () => {
    const w = new ProxyWatchdog(handle(), 'bee', 8787, { isUp: async () => false, ensure: async () => { throw new Error('no login'); } });
    expect(await w.check()).toBe('down');
  });
});
