import { spawn, type ChildProcess } from 'node:child_process';
import { sleep } from '../util/backoff.js';

export interface ProxyHandle {
  url: string;
  /** True when Nectar started the proxy (and should stop it). */
  owned: boolean;
  stop(): void;
}

export async function isUp(url: string, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(new URL('/v1/me', url), { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Reuse a running `bee proxy` on the port, or start one with no idle timeout.
 * Requires `bee login` to have been run first.
 */
export async function ensureProxy(
  beeBin: string,
  port: number,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<ProxyHandle> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `http://127.0.0.1:${port}`;
  if (await isUp(url, fetchImpl)) return { url, owned: false, stop: () => {} };

  const child: ChildProcess = spawn(beeBin, ['proxy', '--port', String(port), '--idle-timeout', '0'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
  let exited: number | null = null;
  child.once('exit', (code) => (exited = code ?? -1));
  child.once('error', () => (exited = -1));

  const deadline = Date.now() + (opts.timeoutMs ?? 15_000);
  while (Date.now() < deadline) {
    if (exited !== null) {
      throw new Error(`bee proxy exited (${exited}). Did you run "bee login"? ${stderr.trim()}`);
    }
    if (await isUp(url, fetchImpl)) return { url, owned: true, stop: () => child.kill('SIGTERM') };
    await sleep(300);
  }
  child.kill('SIGTERM');
  throw new Error(`bee proxy did not answer on ${url} within ${opts.timeoutMs ?? 15_000} ms`);
}
