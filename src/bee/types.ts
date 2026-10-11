/**
 * Bee data types. Bee's docs do not publish full response schemas, so these
 * types cover the fields Nectar relies on and keep everything else as-is.
 * Fields marked "verify" are assumptions to confirm against live data in Phase 0.
 */
export type BeeId = string | number;

export interface BeeTodo {
  id: BeeId;
  text: string;
  completed?: boolean;
  /** Returned as epoch milliseconds; sent as ISO 8601. */
  alarm_at?: number | null;
  [key: string]: unknown;
}

export interface BeeFact {
  id: BeeId;
  text: string;
  confirmed?: boolean;
  [key: string]: unknown;
}

export interface BeeUtterance {
  id?: BeeId;
  text: string;
  speaker?: string;
  /** verify: start time field name and unit */
  start?: number;
  conversation_id?: BeeId;
  [key: string]: unknown;
}

export interface BeeConversation {
  id: BeeId;
  title?: string;
  summary?: string;
  utterances?: BeeUtterance[];
  [key: string]: unknown;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  raw: unknown;
}

export interface ChangeRef {
  type: string;
  id: BeeId;
}

export interface ChangesPage {
  changes: ChangeRef[];
  cursor: string | null;
  raw: unknown;
}

type Raw = Record<string, unknown>;

export type BeeEvent =
  | { kind: 'utterance'; utterance: BeeUtterance; conversationId: string | null; raw: Raw }
  | { kind: 'conversation'; conversation: BeeConversation; raw: Raw }
  | { kind: 'todo'; todo: BeeTodo; raw: Raw }
  | { kind: 'journal'; journal: Raw; text: string | null; raw: Raw }
  | { kind: 'connected'; raw: Raw }
  | { kind: 'unknown'; name: string | null; raw: Raw };

export const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

const idOf = (v: unknown): string | null =>
  typeof v === 'string' || typeof v === 'number' ? String(v) : null;

/**
 * Classify a stream payload. In `bee stream --json` mode there is no top-level
 * event name, so events are told apart by their structural keys (per Bee docs).
 * In SSE mode the `event:` name is passed as a hint.
 */
export function classifyEvent(payload: unknown, eventName: string | null = null): BeeEvent {
  const raw: Raw = isObject(payload) ? payload : { value: payload };
  const name = eventName ?? (typeof raw.type === 'string' ? raw.type : null);

  if (name === 'connected' || raw.connected === true) return { kind: 'connected', raw };

  if (isObject(raw.utterance)) {
    const u = raw.utterance as BeeUtterance;
    const conversationId =
      idOf(u.conversation_id) ??
      idOf(raw.conversation_id) ??
      idOf(raw.conversationId) ??
      (isObject(raw.conversation) ? idOf(raw.conversation.id) : null);
    return { kind: 'utterance', utterance: u, conversationId, raw };
  }
  if (isObject(raw.todo)) return { kind: 'todo', todo: raw.todo as BeeTodo, raw };
  if (isObject(raw.journal) || name?.startsWith('journal')) {
    const journal = isObject(raw.journal) ? raw.journal : raw;
    const text =
      typeof raw.text === 'string' ? raw.text : typeof journal.text === 'string' ? journal.text : null;
    return { kind: 'journal', journal, text, raw };
  }
  if (isObject(raw.conversation)) {
    return { kind: 'conversation', conversation: raw.conversation as BeeConversation, raw };
  }
  return { kind: 'unknown', name, raw };
}
