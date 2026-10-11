import { describe, expect, it } from 'vitest';
import { EveningReview, REVIEW_LAST_KEY, reviewDue, reviewSummary } from '../src/actions/review.js';
import { Store } from '../src/store/db.js';
import { FakeBee } from './helpers/fake-bee.js';

const tz = 'Africa/Monrovia';
const evening = new Date('2026-10-12T18:00:00Z');
const base = { who: null, dueText: null, dueAt: null, confidence: 0.9, quote: '' };

describe('reviewSummary', () => {
  it('fits the wrist', () => {
    expect(reviewSummary(0, 0, [])).toBe('Nectar: no promises today');
    expect(reviewSummary(2, 2, [])).toBe('Nectar: 2/2 kept today. All done!');
    const s = reviewSummary(1, 3, [{ what: 'Send Musa the price list' }, { what: 'x' }] as never);
    expect(s).toBe('Nectar: 1/3 kept today. Open: Send Musa the price list +1');
    expect(reviewSummary(0, 1, [{ what: 'y'.repeat(200) }] as never).length).toBeLessThanOrEqual(80);
  });
});

describe('EveningReview', () => {
  const setup = () => {
    const bee = new FakeBee();
    const store = new Store(':memory:');
    const kept = store.insertCommitment({ ...base, what: 'Send Musa the price list' }, 'c', 'open');
    const tickedInApp = store.insertCommitment({ ...base, what: 'Call the landlord' }, 'c', 'open');
    const open = store.insertCommitment({ ...base, what: 'Update the stock sheet' }, 'c', 'open');
    const future = store.insertCommitment({ ...base, what: 'Visit Duala branch' }, 'c', 'open');
    const due = new Date('2026-10-12T15:00:00Z');
    store.markScheduled(tickedInApp, 't2', due, due);
    store.markScheduled(open, 't3', due, due);
    store.markScheduled(future, 't4', new Date('2026-10-15T09:00:00Z'), due);
    store.markDone(kept, 'voice', Date.parse('2026-10-12T14:00:00Z'));
    bee.todos.set('t2', { id: 't2', text: 'Call the landlord', completed: true });
    bee.todos.set('t3', { id: 't3', text: 'Update the stock sheet', completed: false });
    bee.todos.set('t4', { id: 't4', text: 'Visit Duala', completed: false });
    return { bee, store, open };
  };

  it('syncs completion, carries over open items and notifies', async () => {
    const { bee, store, open } = setup();
    const r = await new EveningReview(bee.asClient(), store, { timezone: tz, notify: true }).run(evening);
    expect(r.kept.map((c) => c.what).sort()).toEqual(['Call the landlord', 'Send Musa the price list']);
    expect(r.open.map((c) => c.what)).toEqual(['Update the stock sheet']);
    expect(r.carriedOver).toHaveLength(1);
    expect(r.summary).toBe('Nectar: 2/3 kept today. Open: Update the stock sheet');
    expect(bee.todos.get('t3')!.alarm_at).toBe(Date.parse('2026-10-13T09:00:00Z'));
    expect(store.getCommitment(open)!.alarmAt).toBe(Date.parse('2026-10-13T09:00:00Z'));
    expect(bee.todos.get(r.summaryTodoId!)!.text).toBe(r.summary);
    expect(store.get(REVIEW_LAST_KEY)).toBe('2026-10-12');
  });

  it('dry run changes nothing', async () => {
    const { bee, store } = setup();
    const before = bee.writes.length;
    const r = await new EveningReview(bee.asClient(), store, { timezone: tz, notify: true, dryRun: true }).run(evening);
    expect(bee.writes.length).toBe(before);
    expect(r.summaryTodoId).toBeNull();
    expect(store.get(REVIEW_LAST_KEY)).toBeNull();
  });

  it('flags open items the daily summary mentions', async () => {
    const { bee, store } = setup();
    bee.daily = [{ summary: 'You updated the stock sheet with Ama in the afternoon.' }];
    const r = await new EveningReview(bee.asClient(), store, { timezone: tz, dryRun: true }).run(evening);
    expect(r.maybeDone.map((c) => c.what)).toEqual(['Update the stock sheet']);
  });
});

describe('reviewDue', () => {
  it('fires once per day at or after the review time', () => {
    expect(reviewDue(new Date('2026-10-12T17:59:00Z'), '18:00', tz, null)).toBe(false);
    expect(reviewDue(evening, '18:00', tz, null)).toBe(true);
    expect(reviewDue(evening, '18:00', tz, '2026-10-12')).toBe(false);
    expect(reviewDue(evening, 'bad', tz, null)).toBe(false);
  });
});
