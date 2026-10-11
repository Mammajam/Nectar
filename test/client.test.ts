import { describe, expect, it, vi } from 'vitest';
import { BeeApiError, BeeClient, toChangesPage, toPage } from '../src/bee/client.js';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  );
}

describe('BeeClient', () => {
  it('creates a todo with alarm_at as ISO 8601', async () => {
    const f = mockFetch(200, { id: 1, text: 'Send price list', alarm_at: 1760000000000 });
    const client = new BeeClient('http://127.0.0.1:8787', f as unknown as typeof fetch);
    const at = new Date('2026-10-13T14:50:00Z');
    const todo = await client.createTodo({ text: 'Send price list', alarmAt: at });
    expect(todo.id).toBe(1);
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe('http://127.0.0.1:8787/v1/todos');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ text: 'Send price list', alarm_at: '2026-10-13T14:50:00.000Z' });
  });

  it('completes a todo with PUT', async () => {
    const f = mockFetch(200, { id: 'a', text: 'x', completed: true });
    await new BeeClient('http://h', f as unknown as typeof fetch).completeTodo('a');
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe('http://h/v1/todos/a');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ completed: true });
  });

  it('passes the changes cursor as a query parameter', async () => {
    const f = mockFetch(200, { changes: [], next_cursor: 'c2' });
    const page = await new BeeClient('http://h', f as unknown as typeof fetch).changes('c1');
    expect(String(f.mock.calls[0]![0])).toBe('http://h/v1/changes?cursor=c1');
    expect(page.cursor).toBe('c2');
  });

  it('throws BeeApiError with status on failure', async () => {
    const f = mockFetch(401, 'unauthorized');
    await expect(new BeeClient('http://h', f as unknown as typeof fetch).me()).rejects.toBeInstanceOf(BeeApiError);
  });
});

describe('response normalizers', () => {
  it('toPage finds items in arrays, keyed objects and generic wrappers', () => {
    expect(toPage([{ id: 1 }]).items).toHaveLength(1);
    expect(toPage({ todos: [{ id: 1 }, { id: 2 }], next_cursor: 'n' }, 'todos')).toMatchObject({ nextCursor: 'n' });
    expect(toPage({ data: [{ id: 1 }] }).items).toHaveLength(1);
    expect(toPage(null).items).toEqual([]);
  });

  it('toChangesPage reads list-shaped and keyed-shaped changefeeds', () => {
    const a = toChangesPage({ changes: [{ type: 'conversations', id: 5 }, { entity: 'todo', id: 'x' }], cursor: 'k' });
    expect(a.changes).toEqual([{ type: 'conversation', id: 5 }, { type: 'todo', id: 'x' }]);
    expect(a.cursor).toBe('k');
    const b = toChangesPage({ conversations: [1, 2], todos: [{ id: 3 }], next_cursor: 'z' });
    expect(b.changes).toEqual([
      { type: 'conversation', id: 1 },
      { type: 'conversation', id: 2 },
      { type: 'todo', id: 3 },
    ]);
  });
});
