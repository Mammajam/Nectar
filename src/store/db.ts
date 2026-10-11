import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { classifyEvent, conversationRefs, type BeeEvent } from '../bee/types.js';
import type { Commitment } from '../ai/types.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  conversation_id TEXT,
  text TEXT,
  payload TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_conv ON events(conversation_id, id);

CREATE TABLE IF NOT EXISTS commitments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  who TEXT,
  what TEXT NOT NULL,
  due_at INTEGER,
  confidence REAL,
  source_conversation_id TEXT,
  bee_todo_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  due_text TEXT,
  quote TEXT
);

-- Stream events identify a conversation by uuid; the changefeed and API use a numeric id.
CREATE TABLE IF NOT EXISTS conversation_ids (
  id TEXT PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export type CommitmentStatus = 'open' | 'suggested' | 'done' | 'dismissed';

export interface StoredCommitment extends Commitment {
  id: number;
  conversationId: string | null;
  status: CommitmentStatus;
  beeTodoId: string | null;
  createdAt: number;
  /** When Nectar scheduled it (after resolving "Friday" etc.), epoch ms. */
  scheduledDueAt: number | null;
  alarmAt: number | null;
  doneAt: number | null;
  doneVia: string | null;
}

export interface StoredEvent {
  id: number;
  kind: string;
  conversation_id: string | null;
  text: string | null;
  received_at: number;
}

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

export const utteranceKey = (conversation: string | null, speaker: string | undefined, text: string): string =>
  `utterance:${sha1(`${conversation}|${speaker ?? ''}|${normalize(text)}`)}`;

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Stable key so the same utterance seen via stream and via catch-up is stored once.
 * Stream utterances have no id or timestamp, so the key is conversation + speaker
 * + normalized text: the same words repeated in one conversation count once.
 */
export function dedupeKey(e: BeeEvent, conversationKey: string | null = null): string {
  switch (e.kind) {
    case 'utterance': {
      const u = e.utterance;
      if (u.id !== undefined) return `utterance:${u.id}`;
      return utteranceKey(conversationKey ?? e.conversationId, u.speaker, u.text);
    }
    case 'conversation':
      return `conversation:${e.conversation.id}:${sha1(JSON.stringify(e.raw))}`;
    case 'todo':
      return `todo:${e.todo.id}:${sha1(JSON.stringify(e.raw))}`;
    default:
      return `${e.kind}:${sha1(JSON.stringify(e.raw))}`;
  }
}

function eventText(e: BeeEvent): string | null {
  switch (e.kind) {
    case 'utterance':
      return e.utterance.text;
    case 'journal':
      return e.text;
    case 'todo':
      return e.todo.text;
    case 'conversation':
      return e.conversation.title ?? e.conversation.summary ?? null;
    default:
      return null;
  }
}

function conversationIdOf(e: BeeEvent): string | null {
  if (e.kind === 'utterance') return e.conversationId;
  if (e.kind === 'conversation') return conversationRefs(e.conversation).uuid ?? String(e.conversation.id);
  return null;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
    this.migrate();
    this.rewriteConversationIds();
  }

  /** Add columns introduced after Phase 1 to databases created earlier. */
  private migrate(): void {
    const cols = new Set(
      (this.db.prepare('PRAGMA table_info(commitments)').all() as { name: string }[]).map((c) => c.name),
    );
    if (!cols.has('due_text')) this.db.exec('ALTER TABLE commitments ADD COLUMN due_text TEXT');
    if (!cols.has('quote')) this.db.exec('ALTER TABLE commitments ADD COLUMN quote TEXT');
    if (!cols.has('alarm_at')) this.db.exec('ALTER TABLE commitments ADD COLUMN alarm_at INTEGER');
    if (!cols.has('scheduled_due_at')) this.db.exec('ALTER TABLE commitments ADD COLUMN scheduled_due_at INTEGER');
    if (!cols.has('done_at')) this.db.exec('ALTER TABLE commitments ADD COLUMN done_at INTEGER');
    if (!cols.has('done_via')) this.db.exec('ALTER TABLE commitments ADD COLUMN done_via TEXT');
  }

  /** Remember that numeric conversation `id` and `uuid` are the same conversation. */
  linkConversation(id: string | number, uuid: string): void {
    const key = String(id);
    if (key === uuid) return;
    const known = this.db.prepare('SELECT uuid FROM conversation_ids WHERE id = ?').get(key) as { uuid: string } | undefined;
    if (known?.uuid === uuid) return;
    this.db.prepare('INSERT OR REPLACE INTO conversation_ids (id, uuid) VALUES (?, ?)').run(key, uuid);
    this.rewriteConversationIds();
  }

  /** The uuid for a numeric conversation id, if learned. */
  uuidFor(id: string | number): string | null {
    const row = this.db.prepare('SELECT uuid FROM conversation_ids WHERE id = ?').get(String(id)) as { uuid: string } | undefined;
    return row?.uuid ?? null;
  }

  /** The numeric id for a conversation uuid, if learned. */
  idFor(uuid: string): string | null {
    const row = this.db.prepare('SELECT id FROM conversation_ids WHERE uuid = ?').get(uuid) as { id: string } | undefined;
    return row?.id ?? null;
  }

  /** Resolve a stored or incoming conversation key to its uuid when one is known. */
  conversationKey(idOrUuid: string | number): string {
    return this.uuidFor(idOrUuid) ?? String(idOrUuid);
  }

  private storedConversationId(e: BeeEvent): string | null {
    const id = conversationIdOf(e);
    return id === null ? null : this.conversationKey(id);
  }

  /** Rewrite numeric conversation ids to uuids wherever the map knows them (idempotent). */
  private rewriteConversationIds(): void {
    // Utterances stored under a numeric id carry a key hashed with it; re-key them so
    // the same words arriving live (uuid) are recognized as already seen.
    const stale = this.db
      .prepare(
        `SELECT e.id, e.payload, m.uuid FROM events e JOIN conversation_ids m ON m.id = e.conversation_id
         WHERE e.kind = 'utterance'`,
      )
      .all() as { id: number; payload: string; uuid: string }[];
    for (const row of stale) {
      let u: { id?: unknown; text?: unknown; speaker?: unknown } | undefined;
      try {
        u = (JSON.parse(row.payload) as { utterance?: typeof u }).utterance;
      } catch {
        continue;
      }
      if (!u || u.id !== undefined || typeof u.text !== 'string') continue;
      const speaker = typeof u.speaker === 'string' ? u.speaker : undefined;
      this.db.prepare('UPDATE OR IGNORE events SET dedupe_key = ? WHERE id = ?').run(utteranceKey(row.uuid, speaker, u.text), row.id);
    }
    this.db.exec(
      `UPDATE events SET conversation_id = (SELECT uuid FROM conversation_ids WHERE id = events.conversation_id)
         WHERE conversation_id IN (SELECT id FROM conversation_ids);
       UPDATE commitments SET source_conversation_id = (SELECT uuid FROM conversation_ids WHERE id = commitments.source_conversation_id)
         WHERE source_conversation_id IN (SELECT id FROM conversation_ids);`,
    );
  }

  /** Returns true when the event was new, false when it was a duplicate. */
  insertEvent(e: BeeEvent, now = Date.now()): boolean {
    if (e.kind === 'connected' || e.kind === 'ignored') return false;
    if (e.kind === 'conversation') {
      const { id, uuid } = conversationRefs(e.conversation);
      if (id && uuid) this.linkConversation(id, uuid);
    }
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO events (kind, conversation_id, text, payload, dedupe_key, received_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(e.kind, this.storedConversationId(e), eventText(e), JSON.stringify(e.raw), dedupeKey(e, e.kind === 'utterance' && e.conversationId ? this.conversationKey(e.conversationId) : null), now);
    return Number(result.changes) > 0;
  }

  /** To-dos Bee itself proposed from voice notes (`aiResponse.todos`) received since `sinceMs`. */
  recentJournalTodos(sinceMs: number): { text: string; receivedAt: number }[] {
    const rows = this.db
      .prepare("SELECT payload, received_at FROM events WHERE kind = 'journal' AND received_at >= ? ORDER BY id")
      .all(sinceMs) as { payload: string; received_at: number }[];
    const out: { text: string; receivedAt: number }[] = [];
    for (const r of rows) {
      let e: BeeEvent;
      try {
        e = classifyEvent(JSON.parse(r.payload));
      } catch {
        continue;
      }
      if (e.kind === 'journal') for (const text of e.aiTodos) out.push({ text, receivedAt: Number(r.received_at) });
    }
    return out;
  }

  utterances(conversationId: string, limit = 200): StoredEvent[] {
    return this.db
      .prepare(
        `SELECT id, kind, conversation_id, text, received_at FROM events
         WHERE kind = 'utterance' AND conversation_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(conversationId, limit)
      .reverse() as unknown as StoredEvent[];
  }

  countEvents(kind?: string): number {
    const row = kind
      ? this.db.prepare('SELECT COUNT(*) AS n FROM events WHERE kind = ?').get(kind)
      : this.db.prepare('SELECT COUNT(*) AS n FROM events').get();
    return Number((row as { n: number }).n);
  }

  insertCommitment(c: Commitment, conversationId: string | null, status: CommitmentStatus, now = Date.now()): number {
    const r = this.db
      .prepare(
        `INSERT INTO commitments (who, what, due_at, due_text, confidence, quote, source_conversation_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(c.who, c.what, c.dueAt ? Date.parse(c.dueAt) : null, c.dueText, c.confidence, c.quote, conversationId, status, now);
    return Number(r.lastInsertRowid);
  }

  /** Open or suggested commitments with the same action from the same conversation, for de-duplication. */
  findSimilarCommitment(what: string, conversationId: string | null): StoredCommitment | null {
    const key = what.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    const rows = this.listCommitments(['open', 'suggested']).filter(
      (c) => c.conversationId === conversationId,
    );
    return rows.find((c) => c.what.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim() === key) ?? null;
  }

  listCommitments(statuses: CommitmentStatus[] = ['open']): StoredCommitment[] {
    const marks = statuses.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT * FROM commitments WHERE status IN (${marks}) ORDER BY COALESCE(scheduled_due_at, due_at, 9e15), id`)
      .all(...statuses) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: Number(r.id),
      who: (r.who as string | null) ?? null,
      what: String(r.what),
      dueText: (r.due_text as string | null) ?? null,
      dueAt: r.due_at == null ? null : new Date(Number(r.due_at)).toISOString(),
      confidence: Number(r.confidence),
      quote: String(r.quote ?? ''),
      conversationId: (r.source_conversation_id as string | null) ?? null,
      status: r.status as CommitmentStatus,
      beeTodoId: (r.bee_todo_id as string | null) ?? null,
      createdAt: Number(r.created_at),
      scheduledDueAt: r.scheduled_due_at == null ? null : Number(r.scheduled_due_at),
      alarmAt: r.alarm_at == null ? null : Number(r.alarm_at),
      doneAt: r.done_at == null ? null : Number(r.done_at),
      doneVia: (r.done_via as string | null) ?? null,
    }));
  }

  getCommitment(id: number): StoredCommitment | null {
    return this.listCommitments(['open', 'suggested', 'done', 'dismissed']).find((c) => c.id === id) ?? null;
  }

  findByTodoId(beeTodoId: string): StoredCommitment | null {
    return this.listCommitments(['open', 'suggested', 'done', 'dismissed']).find((c) => c.beeTodoId === beeTodoId) ?? null;
  }

  /** Open commitments that do not have a Bee to-do yet. */
  unscheduled(): StoredCommitment[] {
    return this.listCommitments(['open']).filter((c) => c.beeTodoId === null);
  }

  markScheduled(id: number, beeTodoId: string, dueAt: Date, alarmAt: Date): void {
    this.db
      .prepare('UPDATE commitments SET bee_todo_id = ?, scheduled_due_at = ?, alarm_at = ? WHERE id = ?')
      .run(beeTodoId, dueAt.getTime(), alarmAt.getTime(), id);
  }

  reschedule(id: number, dueAt: Date, alarmAt: Date): void {
    this.db.prepare('UPDATE commitments SET scheduled_due_at = ?, alarm_at = ? WHERE id = ?').run(dueAt.getTime(), alarmAt.getTime(), id);
  }

  markDone(id: number, via: string, now = Date.now()): void {
    this.db.prepare("UPDATE commitments SET status = 'done', done_at = ?, done_via = ? WHERE id = ?").run(now, via, id);
  }

  setStatus(id: number, status: CommitmentStatus): void {
    this.db.prepare('UPDATE commitments SET status = ? WHERE id = ?').run(status, id);
  }

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  close(): void {
    this.db.close();
  }
}
