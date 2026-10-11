/** Exponential backoff: 1s, 2s, 4s ... capped at maxMs. */
export function backoffDelay(attempt: number, baseMs = 1000, maxMs = 30_000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
