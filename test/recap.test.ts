import { describe, expect, it } from 'vitest';
import { RecapScheduler, parseCalendarEvents, recapText, relevantCommitments } from '../src/actions/recap.js';
import { Store } from '../src/store/db.js';
import { FakeBee } from './helpers/fake-bee.js';

const tz = 'Africa/Monrovia';

describe('parseCalendarEvents', () => {
  it('finds events in common shapes', () => {
    const a = parseCalendarEvents({ calendar: [{ id: 'e1', title: 'Supplier call', start: '2026-10-12T10:00:00Z', attendees: [{ name: 'Musa Kamara' }, 'fatu@shop.lr'] }] });
    expect(a).toEqual([{ id: 'e1', title: 'Supplier call', start: new Date('2026-10-12T10:00:00Z'), attendees: ['Musa Kamara', 'fatu'] }]);
    const b = parseCalendarEvents({ today: { brief: { events: [{ summary: 'Rent with Mr. Kollie', start: { dateTime: '2026-10-12T14:00:00Z' } }] } } });
    expect(b[0]).toMatchObject({ title: 'Rent with Mr. Kollie', attendees: [] });
    expect(b[0]!.id).toHaveLength(12);
    expect(parseCalendarEvents({ events: [{ title: 'No time' }, 'junk'] })).toEqual([]);
    expect(parseCalendarEvents(null)).toEqual([]);
  });
});

describe('recap matching and text', () => {
  const store = new Store(':memory:');
  const base = { dueText: null, dueAt: null, confidence: 0.9, quote: '' };
  store.insertCommitment({ ...base, who: 'Musa', what: 'Send Musa the price list' }, 'c', 'open');
  store.insertCommitment({ ...base, who: 'Musa', what: 'Confirm the rice order' }, 'c', 'open');
  store.insertCommitment({ ...base, who: 'Fatu', what: 'Arrange Duala delivery' }, 'c', 'open');
  const event = { id: 'e1', title: 'Supplier call', start: new Date('2026-10-12T10:00:00Z'), attendees: ['Musa Kamara'] };

  it('picks promises to the attendees', () => {
    expect(relevantCommitments(event, store.listCommitments()).map((c) => c.what)).toEqual(['Send Musa the price list', 'Confirm the rice order']);
  });

  it('writes a wrist-sized recap', () => {
    const items = relevantCommitments(event, store.listCommitments());
    const text = recapText(event, items, new Date('2026-10-12T09:50:00Z'), tz);
    expect(text).toBe('10 AM Supplier call: you owe Send Musa the price list +1');
    expect(text.length).toBeLessThanOrEqual(80);
  });
});

describe('RecapScheduler', () => {
  it('sends one recap inside the lead window and stays quiet otherwise', async () => {
    const bee = new FakeBee();
    const store = new Store(':memory:');
    store.insertCommitment({ who: 'Musa', what: 'Send Musa the price list', dueText: null, dueAt: null, confidence: 0.9, quote: '' }, 'c', 'open');
    let loads = 0;
    const today = async () => {
      loads++;
      return { events: [
        { id: 'e1', title: 'Call with Musa', start: '2026-10-12T10:00:00Z' },
        { id: 'e2', title: 'Team lunch', start: '2026-10-12T10:05:00Z' },
      ] };
    };
    const r = new RecapScheduler(today, bee.asClient(), store, { timezone: tz });
    expect(await r.tick(new Date('2026-10-12T09:40:00Z'))).toEqual([]);
    const sent = await r.tick(new Date('2026-10-12T09:51:00Z'));
    expect(sent.map((s) => s.text)).toEqual(['10 AM Call with Musa: you owe Send Musa the price list']);
    expect(await r.tick(new Date('2026-10-12T09:55:00Z'))).toEqual([]);
    expect(bee.todos.size).toBe(1);
    expect(loads).toBe(2); // calendar re-read after 15 min (09:40 -> 09:55)
  });

  it('tolerates an unavailable calendar', async () => {
    const r = new RecapScheduler(async () => null, new FakeBee().asClient(), new Store(':memory:'), { timezone: tz });
    expect(await r.tick()).toEqual([]);
  });
});
