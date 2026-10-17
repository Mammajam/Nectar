import { describe, expect, it } from 'vitest';
import { CloseOutHandler, closeOutChangedTodos, matchCommitment, parseCloseOut } from '../src/actions/closeout.js';
import { classifyEvent } from '../src/bee/types.js';
import { Store } from '../src/store/db.js';
import { FakeBee } from './helpers/fake-bee.js';

describe('parseCloseOut', () => {
  it.each([
    ['Done with the price list.', 'the price list'],
    ["I've sent Musa the order", 'sent Musa the order'],
    ['I just called the landlord', 'called the landlord'],
    ['Mark the stock sheet as done', 'the stock sheet'],
    ['The sales report is done', 'The sales report'],
    ['Finished the delivery to Duala!', 'the delivery to Duala'],
  ])('%s', (text, phrase) => expect(parseCloseOut(text)).toBe(phrase));

  it('ignores ordinary speech', () => {
    expect(parseCloseOut('Remind me to call Musa')).toBeNull();
  });
});

describe('CloseOutHandler', () => {
  const setup = () => {
    const bee = new FakeBee();
    const store = new Store(':memory:');
    const base = { who: 'Musa', dueText: null, dueAt: null, confidence: 0.9, quote: '' };
    const a = store.insertCommitment({ ...base, what: 'Send Musa the price list' }, 'c1', 'open');
    const b = store.insertCommitment({ ...base, what: 'Call the landlord', who: 'Mr. Kollie' }, 'c1', 'open');
    store.markScheduled(a, 't1', new Date(), new Date());
    bee.todos.set('t1', { id: 't1', text: 'Send Musa the price list · due 3 PM', completed: false });
    return { bee, store, a, b, handler: new CloseOutHandler(bee.asClient(), store) };
  };

  it('completes the matching to-do from a voice journal', async () => {
    const { bee, store, a, handler } = setup();
    const r = await handler.handle(classifyEvent({ text: 'Okay, done with the price list for Musa' }, 'journal-text'));
    expect(r).toMatchObject({ via: 'voice' });
    expect(bee.todos.get('t1')!.completed).toBe(true);
    expect(store.getCommitment(a)).toMatchObject({ status: 'done', doneVia: 'voice' });
  });

  it('marks done when the to-do is ticked off in Bee', async () => {
    const { store, a, handler } = setup();
    const r = await handler.handle(classifyEvent({ todo: { id: 't1', text: 'x', completed: true } }));
    expect(r?.via).toBe('bee-app');
    expect(store.getCommitment(a)?.status).toBe('done');
  });

  it('does nothing for unmatched phrases or non-commands', async () => {
    const { store, handler } = setup();
    expect(await handler.handle(classifyEvent({ text: 'Done with lunch' }, 'journal-text'))).toBeNull();
    expect(await handler.handle(classifyEvent({ text: 'What a day' }, 'journal-text'))).toBeNull();
    expect(store.listCommitments(['open'])).toHaveLength(2);
  });

  it('matchCommitment prefers the best overlap', () => {
    const { store } = setup();
    expect(matchCommitment('called the landlord', store.listCommitments(['open']))?.what).toBe('Call the landlord');
  });
});

describe('closeOutChangedTodos', () => {
  it('completes commitments whose Bee to-do was ticked off elsewhere, and ignores open or missing to-dos', async () => {
    const bee = new FakeBee();
    const store = new Store(':memory:');
    const base = { who: 'Musa', dueText: null, dueAt: null, confidence: 0.9, quote: '' };
    const a = store.insertCommitment({ ...base, what: 'Send Musa the price list' }, 'c1', 'open');
    const b = store.insertCommitment({ ...base, what: 'Call the landlord' }, 'c1', 'open');
    store.markScheduled(a, 't1', new Date(), new Date());
    store.markScheduled(b, 't2', new Date(), new Date());
    bee.todos.set('t1', { id: 't1', text: 'Send Musa the price list', completed: true });
    bee.todos.set('t2', { id: 't2', text: 'Call the landlord', completed: false });
    const results = await closeOutChangedTodos(bee.asClient(), new CloseOutHandler(bee.asClient(), store), ['t1', 't2', 'gone']);
    expect(results.map((r) => [r.commitment.what, r.via])).toEqual([['Send Musa the price list', 'bee-app']]);
    expect(store.getCommitment(a)?.status).toBe('done');
    expect(store.getCommitment(b)?.status).toBe('open');
  });
});
