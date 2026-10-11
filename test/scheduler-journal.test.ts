import { describe, expect, it } from 'vitest';
import { TodoScheduler } from '../src/actions/scheduler.js';
import { classifyEvent } from '../src/bee/types.js';
import { Store } from '../src/store/db.js';
import { FakeBee } from './helpers/fake-bee.js';

const T0 = Date.parse('2026-10-12T09:30:00Z');
let clock = T0;
const opts = { timezone: 'Africa/Monrovia', now: () => new Date(clock) };

/** A documented `journal-updated` payload where Bee proposed its own to-do. */
const journal = (todos: string[]) =>
  classifyEvent({ journal: { id: 991, state: 'READY', text: 'remind me to call the landlord', aiResponse: { cleanedUpText: 'Call the landlord.', todos } } });

function setup(aiTodos: string[]) {
  clock = T0;
  const bee = new FakeBee();
  const store = new Store(':memory:');
  store.insertEvent(journal(aiTodos), T0 - 30_000);
  store.insertCommitment({ who: 'Mr. Kollie', what: 'Call the landlord', dueText: null, dueAt: '2026-10-12T15:00:00Z', confidence: 0.9, quote: '' }, 'c1', 'open');
  return { bee, store, sched: new TodoScheduler(bee.asClient(), null, store, opts) };
}

describe('Bee-created to-dos from voice notes (aiResponse.todos)', () => {
  it('links to the to-do Bee created and only sets the alarm', async () => {
    const { bee, store, sched } = setup(['Call the landlord']);
    bee.todos.set('b1', { id: 'b1', text: 'Call the landlord', completed: false });
    const [r] = await sched.scheduleAll();
    expect(r).toMatchObject({ outcome: 'linked-existing', todoId: 'b1' });
    expect(bee.writes.map((w) => w.op)).toEqual(['update']);
    expect(bee.todos.size).toBe(1);
    expect(store.listCommitments(['open'])[0]!.beeTodoId).toBe('b1');
  });

  it('waits for Bee\'s to-do instead of creating a second one, then creates after the grace period', async () => {
    const { bee, store, sched } = setup(['Call the landlord']);
    const [first] = await sched.scheduleAll();
    expect(first).toMatchObject({ outcome: 'deferred', todoId: null });
    expect(bee.todos.size).toBe(0);
    expect(store.unscheduled()).toHaveLength(1);

    // Bee's to-do appears: the retry links it.
    bee.todos.set('b1', { id: 'b1', text: 'Call the landlord', completed: false });
    expect((await sched.scheduleAll())[0]).toMatchObject({ outcome: 'linked-existing', todoId: 'b1' });
    expect(bee.todos.size).toBe(1);
  });

  it('creates our own to-do once the grace period has passed with nothing from Bee', async () => {
    const { bee, sched } = setup(['Call the landlord']);
    clock = T0 + 5 * 60_000;
    expect((await sched.scheduleAll())[0]).toMatchObject({ outcome: 'created' });
    expect(bee.todos.size).toBe(1);
  });

  it('ignores voice-note to-dos about something else', async () => {
    const { bee, sched } = setup(['Buy rice']);
    expect((await sched.scheduleAll())[0]).toMatchObject({ outcome: 'created' });
    expect(bee.todos.size).toBe(1);
  });

  it('exposes recent journal to-dos from the store, oldest outside the window excluded', () => {
    const { store } = setup(['Call the landlord']);
    store.insertEvent(journal(['Old one']), T0 - 3 * 86_400_000);
    expect(store.recentJournalTodos(T0 - 86_400_000).map((t) => t.text)).toEqual(['Call the landlord']);
  });
});
