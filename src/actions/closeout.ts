import type { BeeClient } from '../bee/client.js';
import { classifyEvent, isObject, type BeeEvent } from '../bee/types.js';
import type { StoredCommitment, Store } from '../store/db.js';
import { overlap } from '../util/text.js';

const TRIGGERS: RegExp[] = [
  /\b(?:mark|tick)\s+(.+?)\s+(?:as\s+)?(?:done|complete|completed|finished)\b/i,
  /\b(?:done with|finished with|finished|completed|took care of|sorted out|sorted)\s+(.+)/i,
  /\bi(?:'ve| have)?\s+(?:just\s+|already\s+)?((?:sent|called|paid|delivered|emailed|checked|fixed|submitted|brought|dropped off|shared|updated|booked|ordered|returned|signed)\b.+)/i,
  /\b(.+?)\s+(?:is|are)\s+(?:done|finished|sorted|complete)\b/i,
];

/** Return the task phrase if the text sounds like "I've done X", else null. */
export function parseCloseOut(text: string): string | null {
  for (const re of TRIGGERS) {
    const m = text.match(re);
    if (m?.[1] && m[1].trim().split(/\s+/).length >= 1) return m[1].trim().replace(/[.!?]+$/, '');
  }
  return null;
}

/** Best open commitment for a phrase, or null if nothing is close enough. */
export function matchCommitment(phrase: string, open: StoredCommitment[], threshold = 0.5): StoredCommitment | null {
  let best: { c: StoredCommitment; score: number } | null = null;
  for (const c of open) {
    const score = overlap(phrase, `${c.what} ${c.who ?? ''}`);
    if (score >= threshold && (!best || score > best.score)) best = { c, score };
  }
  return best?.c ?? null;
}

export interface CloseOutResult {
  commitment: StoredCommitment;
  via: 'voice' | 'bee-app';
  phrase?: string;
}

/**
 * F4 close-out: a voice note like "done with the price list" completes the
 * matching Bee to-do, and a to-do ticked off in the Bee app or watch marks
 * the commitment done in Nectar.
 */
export class CloseOutHandler {
  constructor(
    private readonly client: BeeClient,
    private readonly store: Store,
  ) {}

  async handle(event: BeeEvent): Promise<CloseOutResult | null> {
    if (event.kind === 'todo') {
      const c = this.store.findByTodoId(String(event.todo.id));
      if (c && c.status === 'open' && event.todo.completed === true) {
        this.store.markDone(c.id, 'bee-app');
        return { commitment: c, via: 'bee-app' };
      }
      return null;
    }

    const text = event.kind === 'journal' ? event.text : null;
    if (!text) return null;
    const phrase = parseCloseOut(text);
    if (!phrase) return null;
    const c = matchCommitment(phrase, this.store.listCommitments(['open']));
    if (!c) return null;
    if (c.beeTodoId) await this.client.completeTodo(c.beeTodoId);
    this.store.markDone(c.id, 'voice');
    return { commitment: c, via: 'voice', phrase };
  }
}

/**
 * Close out commitments whose Bee to-do was completed elsewhere (the watch, the app).
 * `bee stream` does not deliver those changes, so this runs on the changefeed's to-do ids.
 */
export async function closeOutChangedTodos(client: BeeClient, handler: CloseOutHandler, ids: string[]): Promise<CloseOutResult[]> {
  const done: CloseOutResult[] = [];
  for (const id of ids) {
    try {
      const fetched = (await client.getTodo(id)) as unknown;
      const todo = isObject(fetched) && isObject(fetched.todo) ? fetched.todo : fetched;
      if (!isObject(todo)) continue;
      const result = await handler.handle(classifyEvent({ todo }));
      if (result) done.push(result);
    } catch {
      /* a to-do deleted since the changefeed listed it is not a problem */
    }
  }
  return done;
}
