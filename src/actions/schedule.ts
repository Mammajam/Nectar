import type { Commitment } from '../ai/types.js';
import { atLocal, localParts, shortWhen } from '../util/time.js';

export interface ScheduleOptions {
  timezone: string;
  /** Alarm this long before the due time. */
  leadMs?: number;
  /** Start of the work day (local hour) used for "tomorrow" and next-day defaults. */
  workdayStartHour?: number;
  /** After this local hour, untimed promises roll to the next morning. */
  sameDayCutoffHour?: number;
  /** Untimed promises made before the cutoff are due this long after now. */
  untimedDelayMs?: number;
}

export interface Schedule {
  dueAt: Date;
  alarmAt: Date;
  /** How the due time was decided, for logs and the demo. */
  source: 'model' | 'text' | 'default' | 'past-due';
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Rule-based backup for the model: resolve common time phrases when the model
 * gave dueText but no dueAt. Returns null when nothing matches.
 */
export function parseDueText(text: string, now: Date, timezone: string, workdayStartHour = 9): Date | null {
  const t = text.toLowerCase();
  const p = localParts(now, timezone);
  const today = (hour: number, minute = 0) => atLocal(now, timezone, { hour, minute });
  const future = (d: Date) => (d.getTime() > now.getTime() ? d : null);

  let m = t.match(/\bin (\d+|an?|half an) (minute|min|hour|hr)s?\b/);
  if (m) {
    const n = m[1] === 'a' || m[1] === 'an' ? 1 : m[1] === 'half an' ? 0.5 : Number(m[1]);
    return new Date(now.getTime() + n * (m[2]!.startsWith('h') ? 3_600_000 : 60_000));
  }

  const tomorrow = /\btomorrow|tmrw\b/.test(t);
  const partOfDay = /\bmorning\b/.test(t) ? workdayStartHour : /\bafternoon\b/.test(t) ? 14 : /\b(evening|tonight)\b/.test(t) ? 20 : null;

  m = t.match(/\b(?:by|at|before)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/);
  let clockHour: number | null = null;
  let clockMinute = 0;
  if (m && (m[3] || m[2] || /\b(by|at|before)\s+\d/.test(t))) {
    let h = Number(m[1]);
    clockMinute = m[2] ? Number(m[2]) : 0;
    const pm = m[3]?.startsWith('p');
    const am = m[3]?.startsWith('a');
    if (pm && h < 12) h += 12;
    if (am && h === 12) h = 0;
    // "by 3" with no am/pm during work hours means 3 PM.
    if (!m[3] && h >= 1 && h <= 7) h += 12;
    if (h <= 23 && clockMinute <= 59) clockHour = h;
  }

  const dayIdx = DAYS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(t));
  if (dayIdx >= 0) {
    let add = (dayIdx - p.weekday + 7) % 7;
    if (add === 0) add = 7; // "Friday" said on a Friday means next week
    return atLocal(now, timezone, { addDays: add, hour: clockHour ?? partOfDay ?? workdayStartHour, minute: clockHour !== null ? clockMinute : 0 });
  }
  if (tomorrow) {
    return atLocal(now, timezone, { addDays: 1, hour: clockHour ?? partOfDay ?? workdayStartHour, minute: clockHour !== null ? clockMinute : 0 });
  }
  if (/\b(end of (the )?day|eod|close of business|cob)\b/.test(t)) return future(today(17)) ?? new Date(now.getTime() + 3_600_000);
  if (/\bnext week\b/.test(t)) {
    const add = ((1 - p.weekday + 7) % 7) || 7;
    return atLocal(now, timezone, { addDays: add, hour: workdayStartHour });
  }
  if (clockHour !== null) {
    const d = today(clockHour, clockMinute);
    return future(d) ?? atLocal(now, timezone, { addDays: 1, hour: clockHour, minute: clockMinute });
  }
  if (partOfDay !== null) return future(today(partOfDay)) ?? new Date(now.getTime() + 3_600_000);
  return null;
}

/** Default for promises with no time: the next work block. */
export function defaultDue(now: Date, opts: Required<Pick<ScheduleOptions, 'timezone' | 'workdayStartHour' | 'sameDayCutoffHour' | 'untimedDelayMs'>>): Date {
  const hour = localParts(now, opts.timezone).hour;
  if (hour >= opts.workdayStartHour - 2 && hour < opts.sameDayCutoffHour) return new Date(now.getTime() + opts.untimedDelayMs);
  // Late evening, or very early morning: next work-day start (today if before it).
  const addDays = hour < opts.workdayStartHour - 2 ? 0 : 1;
  return atLocal(now, opts.timezone, { addDays, hour: opts.workdayStartHour });
}

export function scheduleCommitment(c: Commitment, now: Date, options: ScheduleOptions): Schedule {
  const opts = {
    leadMs: 10 * 60_000,
    workdayStartHour: 9,
    sameDayCutoffHour: 16,
    untimedDelayMs: 2 * 3_600_000,
    ...options,
  };
  let dueAt: Date | null = null;
  let source: Schedule['source'] = 'model';
  if (c.dueAt && !Number.isNaN(Date.parse(c.dueAt))) dueAt = new Date(c.dueAt);
  if (!dueAt && c.dueText) {
    dueAt = parseDueText(c.dueText, now, opts.timezone, opts.workdayStartHour);
    source = 'text';
  }
  if (!dueAt) {
    dueAt = defaultDue(now, opts);
    source = 'default';
  }
  // A due time already behind us ("by 3 PM" heard at 3:05): give a short grace period.
  if (dueAt.getTime() <= now.getTime() + 60_000) {
    dueAt = new Date(now.getTime() + 15 * 60_000);
    source = 'past-due';
  }
  const alarmAt = new Date(Math.max(dueAt.getTime() - opts.leadMs, now.getTime() + 60_000));
  return { dueAt, alarmAt, source };
}

export const MAX_WRIST_CHARS = 80;

/** Glanceable to-do text for the watch, at most 80 characters. */
export function wristText(c: Pick<Commitment, 'what'>, dueAt: Date, now: Date, timezone: string): string {
  const suffix = ` · due ${shortWhen(dueAt, now, timezone)}`;
  const room = MAX_WRIST_CHARS - suffix.length;
  const what = c.what.trim().replace(/\s+/g, ' ');
  const head = what.length <= room ? what : `${what.slice(0, room - 1).trimEnd()}…`;
  return `${head}${suffix}`;
}
