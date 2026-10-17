/**
 * Bee data types. The CLI changefeed and `bee stream` payloads are documented
 * (https://docs.bee.computer/docs/realtime, /agentic-sync); REST proxy
 * responses are not, so these types cover the fields Nectar relies on and keep
 * everything else as-is. Fields marked "verify" are assumptions to confirm
 * against live data.
 */
export type BeeId = string | number;

export interface BeeTodo {
  id: BeeId;
  text: string;
  completed?: boolean;
  /** Returned as epoch milliseconds; sent as ISO 8601. */
  alarm_at?: number | null;
  /** Stream events name the alarm `alarmAt` (epoch milliseconds). */
  alarmAt?: number | null;
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
  /** Stream utterances carry the conversation uuid (documented). */
  conversation_uuid?: string;
  [key: string]: unknown;
}

export interface BeeConversation {
  id: BeeId;
  /** Present on stream `new-conversation` events; the API shape is unverified. */
  uuid?: string;
  state?: string;
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
  /** Lifecycle state when the changefeed reports one (conversations: `COMPLETED`, journals: `READY`). */
  state?: string;
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
  | {
      kind: 'journal';
      journal: Raw;
      /** Text to act on; null when the journal is not ready or has no text. */
      text: string | null;
      journalId: string | null;
      /** To-dos Bee itself proposed from the voice note (`aiResponse.todos`). */
      aiTodos: string[];
      raw: Raw;
    }
  | { kind: 'connected'; raw: Raw }
  /** Documented events Nectar deliberately ignores (e.g. `update-location`). */
  | { kind: 'ignored'; name: string; raw: Raw }
  | { kind: 'unknown'; name: string | null; raw: Raw };

export const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

const idOf = (v: unknown): string | null =>
  typeof v === 'string' || typeof v === 'number' ? String(v) : null;

/** Journals are usable once Bee has finished processing them. */
const isReady = (state: unknown): boolean => state === undefined || state === null || String(state).toLowerCase() === 'ready';

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);

/** The numeric id and uuid of a conversation object, when present. */
export function conversationRefs(c: { id?: unknown; uuid?: unknown }): { id: string | null; uuid: string | null } {
  return { id: idOf(c.id), uuid: typeof c.uuid === 'string' && c.uuid ? c.uuid : null };
}

/**
 * Classify a stream payload. In `bee stream --json` mode there is no top-level
 * event name, so events are told apart by their structural keys; the shapes
 * follow https://docs.bee.computer/docs/realtime. In SSE mode the `event:` name
 * is passed as a hint.
 *
 * Conversations are keyed by uuid: stream utterances carry `conversation_uuid`,
 * while the changefeed and API use a numeric id (see `Store.linkConversation`).
 */
export function classifyEvent(payload: unknown, eventName: string | null = null): BeeEvent {
  const raw: Raw = isObject(payload) ? payload : { value: payload };
  const name = eventName ?? (typeof raw.type === 'string' ? raw.type : null);

  if (name === 'connected' || raw.connected === true) return { kind: 'connected', raw };
  // `bee stream --json` opens with a bare `{ "timestamp": <ms> }` (not in the docs): treat it as the connect signal.
  if (name === null && Object.keys(raw).length === 1 && typeof raw.timestamp === 'number') return { kind: 'connected', raw };

  if (isObject(raw.utterance)) {
    const u = raw.utterance as BeeUtterance;
    const conversationId =
      idOf(raw.conversation_uuid) ??
      idOf(u.conversation_uuid) ??
      idOf(u.conversation_id) ??
      idOf(raw.conversation_id) ??
      idOf(raw.conversationId) ??
      (isObject(raw.conversation) ? idOf(raw.conversation.uuid) ?? idOf(raw.conversation.id) : null);
    return { kind: 'utterance', utterance: u, conversationId, raw };
  }
  if (isObject(raw.todo)) return { kind: 'todo', todo: raw.todo as BeeTodo, raw };

  // Documented events with no wrapper object: ignorable, not "unknown".
  if (name === 'update-conversation-summary' || (name === null && 'conversation_id' in raw && 'short_summary' in raw)) {
    return { kind: 'ignored', name: 'update-conversation-summary', raw };
  }
  if (name === 'update-location' || (name === null && 'conversation_id' in raw && isObject(raw.location))) {
    return { kind: 'ignored', name: 'update-location', raw };
  }

  if (isObject(raw.journal) || 'journalId' in raw || name?.startsWith('journal')) {
    const journal = isObject(raw.journal) ? raw.journal : raw;
    const ai = isObject(journal.aiResponse) ? journal.aiResponse : null;
    const clean = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null);
    // `journal-created/updated` nest the journal; prefer Bee's cleaned-up text.
    // `journal-text` is `{journalId, text}` with the text at the top level.
    const text = isReady(journal.state)
      ? clean(ai?.cleanedUpText) ?? clean(journal.text) ?? clean(raw.text)
      : null;
    const journalId = idOf(journal.id) ?? idOf(raw.journalId);
    return { kind: 'journal', journal, text, journalId, aiTodos: strings(ai?.todos), raw };
  }
  if (isObject(raw.conversation)) {
    return { kind: 'conversation', conversation: raw.conversation as BeeConversation, raw };
  }
  return { kind: 'unknown', name, raw };
}
