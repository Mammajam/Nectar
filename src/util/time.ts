/** Wall-clock helpers in an IANA timezone, without external libraries. */

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function localParts(date: Date, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: WEEKDAYS.indexOf(get('weekday')),
  };
}

/** Offset of `timezone` from UTC at `date`, in ms (positive east of Greenwich). */
export function tzOffsetMs(date: Date, timezone: string): number {
  const p = localParts(date, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000;
}

/** The instant when the wall clock in `timezone` reads the given local time. */
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let t = guess - tzOffsetMs(new Date(guess), timezone);
  t = guess - tzOffsetMs(new Date(t), timezone); // second pass settles DST edges
  return new Date(t);
}

/** Local midnight-based day arithmetic: the same wall-clock time `days` later. */
export function atLocal(base: Date, timezone: string, opts: { addDays?: number; hour: number; minute?: number }): Date {
  const p = localParts(base, timezone);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + (opts.addDays ?? 0)));
  return zonedTime(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), opts.hour, opts.minute ?? 0, timezone);
}

export function sameLocalDay(a: Date, b: Date, timezone: string): boolean {
  const x = localParts(a, timezone);
  const y = localParts(b, timezone);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

export function localDateKey(date: Date, timezone: string): string {
  const p = localParts(date, timezone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function clock(date: Date, timezone: string): string {
  const p = localParts(date, timezone);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const ampm = p.hour < 12 ? 'AM' : 'PM';
  return p.minute === 0 ? `${h12} ${ampm}` : `${h12}:${String(p.minute).padStart(2, '0')} ${ampm}`;
}

/** Short, glanceable time for a watch: "3 PM", "tmrw 9 AM", "Thu 3:30 PM". */
export function shortWhen(date: Date, now: Date, timezone: string): string {
  if (sameLocalDay(date, now, timezone)) return clock(date, timezone);
  if (sameLocalDay(date, atLocal(now, timezone, { addDays: 1, hour: 12 }), timezone)) return `tmrw ${clock(date, timezone)}`;
  return `${WEEKDAYS[localParts(date, timezone).weekday]} ${clock(date, timezone)}`;
}
