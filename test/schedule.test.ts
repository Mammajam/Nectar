import { describe, expect, it } from 'vitest';
import { MAX_WRIST_CHARS, defaultDue, parseDueText, scheduleCommitment, wristText } from '../src/actions/schedule.js';

const tz = 'Africa/Monrovia';
const mon930 = new Date('2026-10-12T09:30:00Z'); // Monday
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe('parseDueText', () => {
  it.each([
    ['by 3 PM', '2026-10-12T15:00:00.000Z'],
    ['by 3', '2026-10-12T15:00:00.000Z'],
    ['at 10:30am', '2026-10-12T10:30:00.000Z'],
    ['by 8 AM', '2026-10-13T08:00:00.000Z'], // already past today
    ['tonight', '2026-10-12T20:00:00.000Z'],
    ['end of day', '2026-10-12T17:00:00.000Z'],
    ['this afternoon', '2026-10-12T14:00:00.000Z'],
    ['tomorrow morning', '2026-10-13T09:00:00.000Z'],
    ['tomorrow at 2 pm', '2026-10-13T14:00:00.000Z'],
    ['Thursday', '2026-10-15T09:00:00.000Z'],
    ['Friday afternoon', '2026-10-16T14:00:00.000Z'],
    ['Monday', '2026-10-19T09:00:00.000Z'], // said on a Monday: next week
    ['in 2 hours', '2026-10-12T11:30:00.000Z'],
    ['in half an hour', '2026-10-12T10:00:00.000Z'],
    ['next week', '2026-10-19T09:00:00.000Z'],
  ])('%s', (text, expected) => {
    expect(iso(parseDueText(text, mon930, tz))).toBe(expected);
  });

  it('returns null for unknown phrases', () => {
    expect(parseDueText('sometime', mon930, tz)).toBeNull();
  });
});

describe('defaultDue (next work block)', () => {
  const opts = { timezone: tz, workdayStartHour: 9, sameDayCutoffHour: 16, untimedDelayMs: 2 * 3_600_000 };
  it('is 2 h later during the day', () => {
    expect(iso(defaultDue(mon930, opts))).toBe('2026-10-12T11:30:00.000Z');
  });
  it('rolls to 9 AM next day after the cutoff', () => {
    expect(iso(defaultDue(new Date('2026-10-12T17:00:00Z'), opts))).toBe('2026-10-13T09:00:00.000Z');
  });
  it('is 9 AM today in the early morning', () => {
    expect(iso(defaultDue(new Date('2026-10-12T05:00:00Z'), opts))).toBe('2026-10-12T09:00:00.000Z');
  });
});

describe('scheduleCommitment', () => {
  const base = { who: null, confidence: 0.9, quote: '' };
  it('uses the model time and sets the alarm 10 min before', () => {
    const s = scheduleCommitment({ ...base, what: 'x', dueText: 'by 3 PM', dueAt: '2026-10-12T15:00:00Z' }, mon930, { timezone: tz });
    expect(s).toMatchObject({ source: 'model' });
    expect(iso(s.alarmAt)).toBe('2026-10-12T14:50:00.000Z');
  });
  it('falls back to the text, then the default', () => {
    expect(scheduleCommitment({ ...base, what: 'x', dueText: 'tonight', dueAt: null }, mon930, { timezone: tz }).source).toBe('text');
    expect(scheduleCommitment({ ...base, what: 'x', dueText: null, dueAt: null }, mon930, { timezone: tz }).source).toBe('default');
  });
  it('gives a 15 min grace when the due time has passed', () => {
    const s = scheduleCommitment({ ...base, what: 'x', dueText: null, dueAt: '2026-10-12T09:00:00Z' }, mon930, { timezone: tz });
    expect(s.source).toBe('past-due');
    expect(iso(s.dueAt)).toBe('2026-10-12T09:45:00.000Z');
    expect(iso(s.alarmAt)).toBe('2026-10-12T09:35:00.000Z');
  });
  it('never sets an alarm in the past', () => {
    const s = scheduleCommitment({ ...base, what: 'x', dueText: null, dueAt: '2026-10-12T09:35:00Z' }, mon930, { timezone: tz, leadMs: 30 * 60_000 });
    expect(s.alarmAt.getTime()).toBeGreaterThan(mon930.getTime());
  });
});

describe('wristText', () => {
  it('fits 80 characters and keeps the due time', () => {
    const t = wristText({ what: 'Send Musa the price list' }, new Date('2026-10-12T15:00:00Z'), mon930, tz);
    expect(t).toBe('Send Musa the price list · due 3 PM');
    const long = wristText({ what: 'x'.repeat(200) }, new Date('2026-10-15T09:00:00Z'), mon930, tz);
    expect(long.length).toBeLessThanOrEqual(MAX_WRIST_CHARS);
    expect(long.endsWith('· due Thu 9 AM')).toBe(true);
  });
});
