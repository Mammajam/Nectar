import { isObject } from './types.js';
import type {
  BeeConversation,
  BeeFact,
  BeeId,
  BeeTodo,
  ChangeRef,
  ChangesPage,
  Page,
} from './types.js';

export class BeeApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: string,
  ) {
    super(`Bee API ${method} ${path} failed with ${status}: ${body.slice(0, 200)}`);
    this.name = 'BeeApiError';
  }
}

export interface ListParams {
  limit?: number;
  cursor?: string | null;
}

/** Pick the item array out of a list response whose exact shape is not documented. */
export function toPage<T>(raw: unknown, preferredKey?: string): Page<T> {
  if (Array.isArray(raw)) return { items: raw as T[], nextCursor: null, raw };
  if (!isObject(raw)) return { items: [], nextCursor: null, raw };
  let items: unknown[] | undefined;
  if (preferredKey && Array.isArray(raw[preferredKey])) items = raw[preferredKey] as unknown[];
  items ??= (['items', 'data', 'results'].map((k) => raw[k]).find(Array.isArray) as unknown[] | undefined);
  items ??= Object.values(raw).find(Array.isArray) as unknown[] | undefined;
  const cursor = raw.next_cursor ?? raw.nextCursor ?? null;
  return { items: (items ?? []) as T[], nextCursor: typeof cursor === 'string' ? cursor : null, raw };
}

const singular = (key: string) => key.replace(/ies$/, 'y').replace(/s$/, '');

/**
 * Normalize the changefeed. The documented shape (`bee changed --json`) is
 * `{ meta: { next_cursor, ... }, conversations: [{ id, state, ... }], facts, todos,
 * dailies, journals }`. The REST `/v1/changes` shape is not documented, so a flat
 * `changes` list and top-level cursor keys are still accepted.
 */
export function toChangesPage(raw: unknown): ChangesPage {
  const changes: ChangeRef[] = [];
  let cursor: string | null = null;
  if (isObject(raw)) {
    const meta = isObject(raw.meta) ? raw.meta : {};
    const c = meta.next_cursor ?? raw.next_cursor ?? raw.cursor ?? raw.nextCursor;
    cursor = typeof c === 'string' ? c : typeof c === 'number' ? String(c) : null;
    const list = raw.changes ?? raw.items;
    const stateOf = (v: Record<string, unknown>) => (typeof v.state === 'string' ? { state: v.state } : {});
    if (Array.isArray(list)) {
      for (const item of list) {
        if (!isObject(item)) continue;
        const type = item.type ?? item.entity ?? item.kind;
        const id = item.id ?? item.entity_id;
        if (typeof type === 'string' && (typeof id === 'string' || typeof id === 'number')) {
          changes.push({ type: singular(type), id, ...stateOf(item) });
        }
      }
    } else {
      // Documented shape: { conversations: [{ id, state }], todos: [...], ... } (`meta` is not an array).
      for (const [key, value] of Object.entries(raw)) {
        if (!Array.isArray(value)) continue;
        for (const v of value) {
          const id = isObject(v) ? v.id : v;
          if (typeof id === 'string' || typeof id === 'number') {
            changes.push({ type: singular(key), id, ...(isObject(v) ? stateOf(v) : {}) });
          }
        }
      }
    }
  }
  return { changes, cursor, raw };
}

/** Typed client for the local Bee API proxy (`bee proxy`, default http://127.0.0.1:8787). */
export class BeeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request<T>(method: string, path: string, body?: unknown, query?: Record<string, unknown>): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const res = await this.fetchImpl(url, {
      method,
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json; charset=utf-8' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new BeeApiError(res.status, method, path, text);
    return (text ? JSON.parse(text) : null) as T;
  }

  me() {
    return this.request<Record<string, unknown>>('GET', '/v1/me');
  }

  // Todos -------------------------------------------------------------------
  async listTodos(p: ListParams = {}) {
    return toPage<BeeTodo>(await this.request('GET', '/v1/todos', undefined, { ...p }), 'todos');
  }
  getTodo(id: BeeId) {
    return this.request<BeeTodo>('GET', `/v1/todos/${encodeURIComponent(String(id))}`);
  }
  createTodo(input: { text: string; alarmAt?: Date | null }) {
    return this.request<BeeTodo>('POST', '/v1/todos', {
      text: input.text,
      ...(input.alarmAt ? { alarm_at: input.alarmAt.toISOString() } : {}),
    });
  }
  updateTodo(id: BeeId, input: { text?: string; completed?: boolean; alarmAt?: Date | null }) {
    const body: Record<string, unknown> = {};
    if (input.text !== undefined) body.text = input.text;
    if (input.completed !== undefined) body.completed = input.completed;
    if (input.alarmAt !== undefined) body.alarm_at = input.alarmAt ? input.alarmAt.toISOString() : null;
    return this.request<BeeTodo>('PUT', `/v1/todos/${encodeURIComponent(String(id))}`, body);
  }
  completeTodo(id: BeeId) {
    return this.updateTodo(id, { completed: true });
  }
  deleteTodo(id: BeeId) {
    return this.request<unknown>('DELETE', `/v1/todos/${encodeURIComponent(String(id))}`);
  }

  // Facts -------------------------------------------------------------------
  async listFacts(p: ListParams = {}) {
    return toPage<BeeFact>(await this.request('GET', '/v1/facts', undefined, { ...p }), 'facts');
  }
  createFact(text: string) {
    return this.request<BeeFact>('POST', '/v1/facts', { text });
  }

  // Conversations, daily summaries, journals --------------------------------
  async listConversations(p: ListParams = {}) {
    return toPage<BeeConversation>(await this.request('GET', '/v1/conversations', undefined, { ...p }), 'conversations');
  }
  getConversation(id: BeeId) {
    return this.request<BeeConversation>('GET', `/v1/conversations/${encodeURIComponent(String(id))}`);
  }
  async listDaily(p: ListParams = {}) {
    return toPage<Record<string, unknown>>(await this.request('GET', '/v1/daily', undefined, { ...p }), 'daily');
  }
  async listJournals(p: ListParams = {}) {
    return toPage<Record<string, unknown>>(await this.request('GET', '/v1/journals', undefined, { ...p }), 'journals');
  }

  // Changefeed --------------------------------------------------------------
  async changes(cursor?: string | null) {
    return toChangesPage(await this.request('GET', '/v1/changes', undefined, { cursor: cursor ?? undefined }));
  }
}
