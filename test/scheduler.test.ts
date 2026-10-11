import { describe, expect, it } from 'vitest';
import { TodoScheduler } from '../src/actions/scheduler.js';
import type { BeeCli } from '../src/bee/cli.js';
import { Store } from '../src/store/db.js';
import { FakeBee } from './helpers/fake-bee.js';

const now = () => new Date('2026-10-12T09:30:00Z');
const opts = { timezone: 'Africa/Monrovia', now };
const add = (s: Store, what: string, dueAt: string | null = null) =>
  s.insertCommitment({ who: null, what, dueText: null, dueAt, confidence: 0.9, quote: what }, 'c1', 'open');

describe('TodoScheduler', () => {
  it('creates a to-do with the wrist text and alarm, once', async () => {
    const bee = new FakeBee();
    const store = new Store(':memory:');
    const id = add(store, 'Send Musa the price list', '2026-10-12T15:00:00Z');
    const sched = new TodoScheduler(bee.asClient(), null, store, opts);
    const [r] = await sched.scheduleAll();
    expect(r).toMatchObject({ outcome: 'created', text: 'Send Musa the price list · due 3 PM' });
    expect(r!.alarmAt.toISOString()).toBe('2026-10-12T14:50:00.000Z');
    expect(store.getCommitment(id)).toMatchObject({ beeTodoId: r!.todoId, alarmAt: Date.parse('2026-10-12T14:50:00Z') });
    expect(await sched.scheduleAll()).toEqual([]);
    expect(bee.todos.size).toBe(1);
  });

  it('links to an existing open Bee to-do instead of duplicating', async () => {
    const bee = new FakeBee();
    bee.todos.set('b9', { id: 'b9', text: 'price list for Musa', completed: false });
    const store = new Store(':memory:');
    add(store, 'Send Musa the price list');
    const [r] = await new TodoScheduler(bee.asClient(), null, store, opts).scheduleAll();
    expect(r).toMatchObject({ outcome: 'linked-existing', todoId: 'b9' });
    expect(bee.todos.size).toBe(1);
    expect(bee.todos.get('b9')!.alarm_at).toBe(r!.alarmAt.getTime());
  });

  it("accepts Bee's own matching suggestion", async () => {
    const bee = new FakeBee();
    const client = bee.asClient();
    const cli = {
      todoSuggestions: async () => [{ id: 's1', text: 'Check rice stock' }],
      acceptSuggestion: async () => (await client.createTodo({ text: 'Check rice stock' })).id,
    } as unknown as BeeCli;
    const store = new Store(':memory:');
    add(store, 'Check the rice stock', '2026-10-15T09:00:00Z');
    const [r] = await new TodoScheduler(client, cli, store, opts).scheduleAll();
    expect(r!.outcome).toBe('accepted-suggestion');
    expect(bee.todos.get(r!.todoId!)!.text).toBe('Check the rice stock · due Thu 9 AM');
  });

  it('reports failures without stopping the batch', async () => {
    const bee = new FakeBee();
    const client = bee.asClient();
    let calls = 0;
    const orig = client.createTodo.bind(client);
    client.createTodo = async (i) => (calls++ === 0 ? Promise.reject(new Error('boom')) : orig(i));
    const store = new Store(':memory:');
    add(store, 'First task');
    add(store, 'Second task');
    const results = await new TodoScheduler(client, null, store, opts).scheduleAll();
    expect(results.map((r) => r.outcome)).toEqual(['failed', 'created']);
    expect(store.unscheduled().map((c) => c.what)).toEqual(['First task']);
  });
});
