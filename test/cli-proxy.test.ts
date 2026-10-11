import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { describeReview, describeScheduled } from '../src/actions/report.js';
import { BeeCli } from '../src/bee/cli.js';
import { ensureProxy } from '../src/bee/proxy.js';

describe('BeeCli', () => {
  it('parses suggestions, today and accepted ids; fails soft', async () => {
    const calls: string[][] = [];
    const cli = new BeeCli('bee', async (_cmd, args) => {
      calls.push(args);
      if (args[1] === 'suggestions') return { stdout: JSON.stringify({ suggestions: [{ id: 's1', text: 'Call Musa' }, { id: 's2' }] }) };
      if (args[1] === 'accept-suggestion') return { stdout: JSON.stringify({ todo: { id: 't9' } }) };
      if (args[0] === 'today') return { stdout: '{"events":[]}' };
      throw new Error('unknown');
    });
    expect(await cli.todoSuggestions()).toEqual([{ id: 's1', text: 'Call Musa' }]);
    expect(await cli.acceptSuggestion('s1')).toBe('t9');
    expect(await cli.today()).toEqual({ events: [] });
    expect(calls[0]).toEqual(['todos', 'suggestions', '--limit', '20', '--json']);

    const broken = new BeeCli('bee', async () => {
      throw new Error('not installed');
    });
    expect(await broken.todoSuggestions()).toEqual([]);
    expect(await broken.acceptSuggestion('x')).toBeNull();
    expect(await broken.today()).toBeNull();
  });
});

describe('ensureProxy', () => {
  it('reuses a proxy that already answers', async () => {
    const server = http.createServer((_req, res) => res.end('{}')).listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const port = (server.address() as AddressInfo).port;
    const h = await ensureProxy('does-not-exist', port);
    expect(h).toMatchObject({ url: `http://127.0.0.1:${port}`, owned: false });
    server.close();
  });

  it('explains when the CLI cannot start', async () => {
    await expect(ensureProxy('/nonexistent/bee', 1, { timeoutMs: 2000 })).rejects.toThrow(/bee proxy exited/);
  });
});

describe('report lines', () => {
  it('describes scheduling outcomes and reviews', () => {
    const now = new Date('2026-10-12T09:30:00Z');
    const base = { commitment: { what: 'Send list' } as never, text: 'Send list · due 3 PM', dueAt: now, alarmAt: new Date('2026-10-12T14:50:00Z'), source: 'model' };
    expect(describeScheduled({ ...base, outcome: 'created', todoId: 't1' }, now, 'Africa/Monrovia')).toBe('[todo created] "Send list · due 3 PM" alarm 2:50 PM (time from model)');
    expect(describeScheduled({ ...base, outcome: 'failed', todoId: null, error: new Error('boom') }, now, 'UTC')).toBe('[todo failed] Send list: boom');
    const lines = describeReview({ date: '2026-10-12', kept: [{ what: 'A', doneVia: 'voice' }] as never, open: [], carriedOver: [{ what: 'B' }] as never, maybeDone: [], summary: 'S', summaryTodoId: 't5' });
    expect(lines).toEqual(['[review 2026-10-12] S', '   kept: A (voice)', '   carried to tomorrow: B', '   summary sent to the wrist as to-do t5']);
  });
});
