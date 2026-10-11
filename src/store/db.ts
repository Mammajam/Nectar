import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BeeEvent } from '../bee/types.js';

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
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export interface StoredEvent {
  id: number;
  kind: string;
  conversation_id: string | null;
  text: string | null;
  received_at: number;
}

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

/** Stable key so the same utterance seen via stream and via catch-up is stored once. */
export function dedupeKey(e: BeeEvent): string {
  switch (e.kind) {
    case 'utterance': {
      const u = e.utterance;
      if (u.id !== undefined) return `utterance:${u.id}`;
      return `utterance:${sha1(`${e.conversationId}|${u.start ?? ''}|${u.speaker ?? ''}|${u.text}`)}`;
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
  if (e.kind === 'conversation') return String(e.conversation.id);
  return null;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  /** Returns true when the event was new, false when it was a duplicate. */
  insertEvent(e: BeeEvent, now = Date.now()): boolean {
    if (e.kind === 'connected') return false;
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO events (kind, conversation_id, text, payload, dedupe_key, received_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(e.kind, conversationIdOf(e), eventText(e), JSON.stringify(e.raw), dedupeKey(e), now);
    return Number(result.changes) > 0;
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
