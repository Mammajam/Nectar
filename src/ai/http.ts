import { backoffDelay, sleep } from '../util/backoff.js';

/** A failed call to a model provider over HTTP (status 0 = could not connect). */
export class LlmHttpError extends Error {
  constructor(
    readonly status: number,
    readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = 'LlmHttpError';
  }
}

const RETRYABLE_STATUS = new Set([0, 408, 409, 429, 500, 502, 503, 504, 529]);

export interface PostOptions {
  provider: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  baseDelayMs?: number;
}

/** POST JSON and parse the JSON reply, retrying throttling and transient errors with backoff. */
export async function postJson(url: string, headers: Record<string, string>, body: unknown, opts: PostOptions): Promise<unknown> {
  const doFetch = opts.fetchImpl ?? fetch;
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  let attempt = 0;
  for (;;) {
    let failure: LlmHttpError;
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (res.ok) {
        try {
          return JSON.parse(text);
        } catch {
          throw new LlmHttpError(res.status, opts.provider, `${opts.provider} returned a non-JSON reply`);
        }
      }
      failure = new LlmHttpError(res.status, opts.provider, `${opts.provider} HTTP ${res.status}: ${text.slice(0, 300)}`);
    } catch (err) {
      if (err instanceof LlmHttpError && err.status !== 0) throw err;
      failure = err instanceof LlmHttpError ? err : new LlmHttpError(0, opts.provider, `could not reach ${opts.provider}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!RETRYABLE_STATUS.has(failure.status) || attempt >= maxRetries) throw failure;
    await sleep(backoffDelay(attempt++, baseDelayMs));
  }
}
