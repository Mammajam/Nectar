import { describe, expect, it } from 'vitest';
import { atLocal, localDateKey, localParts, shortWhen, tzOffsetMs, zonedTime } from '../src/util/time.js';

describe('time helpers', () => {
  it('handles Monrovia (UTC+0) and offset zones', () => {
    const d = new Date('2026-10-12T09:30:00Z');
    expect(localParts(d, 'Africa/Monrovia')).toMatchObject({ year: 2026, month: 10, day: 12, hour: 9, minute: 30, weekday: 1 });
    expect(tzOffsetMs(d, 'Africa/Lagos')).toBe(3_600_000);
    expect(zonedTime(2026, 10, 12, 15, 0, 'Africa/Lagos').toISOString()).toBe('2026-10-12T14:00:00.000Z');
  });

  it('moves days in local time', () => {
    const d = new Date('2026-10-12T23:30:00Z');
    expect(atLocal(d, 'Africa/Monrovia', { addDays: 1, hour: 9 }).toISOString()).toBe('2026-10-13T09:00:00.000Z');
    expect(localDateKey(d, 'Africa/Lagos')).toBe('2026-10-13');
  });

  it('formats glanceable times', () => {
    const now = new Date('2026-10-12T09:30:00Z');
    const tz = 'Africa/Monrovia';
    expect(shortWhen(new Date('2026-10-12T15:00:00Z'), now, tz)).toBe('3 PM');
    expect(shortWhen(new Date('2026-10-13T09:15:00Z'), now, tz)).toBe('tmrw 9:15 AM');
    expect(shortWhen(new Date('2026-10-15T12:00:00Z'), now, tz)).toBe('Thu 12 PM');
  });
});
