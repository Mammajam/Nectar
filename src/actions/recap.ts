import { createHash } from 'node:crypto';
import type { BeeClient } from '../bee/client.js';
import { isObject } from '../bee/types.js';
import type { StoredCommitment, Store } from '../store/db.js';
import { overlap } from '../util/text.js';
import { shortWhen } from '../util/time.js';
import { MAX_WRIST_CHARS } from './schedule.js';

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  attendees: string[];
}

const EVENT_KEYS = ['events', 'calendar', 'calendar_events', 'calendarEvents', 'meetings', 'items'];

function toDate(v: unknown): Date | null {
  if (isObject(v)) return toDate(v.dateTime ?? v.date_time ?? v.date);
  if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000);
  if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return new Date(v);
  return null;
}

function names(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((a) => (typeof a === 'string' ? a : isObject(a) ? (a.name ?? a.displayName ?? a.display_name ?? a.email) : null))
    .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    .map((a) => a.replace(/@.*$/, '').trim());
}

/** Find calendar events anywhere in `bee today --json` output (shape not documented). */
export function parseCalendarEvents(raw: unknown, depth = 0): CalendarEvent[] {
  if (depth > 3) return [];
  let list: unknown[] | null = Array.isArray(raw) ? raw : null;
  if (!list && isObject(raw)) {
    for (const k of EVENT_KEYS) if (Array.isArray(raw[k])) list = raw[k] as unknown[];
    if (!list) {
      for (const v of Object.values(raw)) {
        const nested = parseCalendarEvents(v, depth + 1);
        if (nested.length) return nested;
      }
      return [];
    }
  }
  const out: CalendarEvent[] = [];
  for (const e of list ?? []) {
    if (!isObject(e)) continue;
    const title = e.title ?? e.summary ?? e.name ?? e.subject;
    const start = toDate(e.start ?? e.start_time ?? e.startTime ?? e.start_at ?? e.startAt ?? e.begin);
    if (typeof title !== 'string' || !start) continue;
    const id = typeof e.id === 'string' || typeof e.id === 'number' ? String(e.id) : createHash('sha1').update(`${title}|${start.toISOString()}`).digest('hex').slice(0, 12);
    out.push({ id, title: title.trim(), start, attendees: names(e.attendees ?? e.participants ?? e.guests) });
  }
  return out;
}

/** Open commitments that concern the people or topic of this meeting. */
export function relevantCommitments(event: CalendarEvent, open: StoredCommitment[]): StoredCommitment[] {
  const people = [...event.attendees, event.title].join(' ');
  return open.filter(
    (c) => (c.who !== null && overlap(c.who, people) >= 0.5) || overlap(c.what, event.title) >= 0.6,
  );
}

export function recapText(event: CalendarEvent, items: StoredCommitment[], now: Date, timezone: string): string {
  const when = shortWhen(event.start, now, timezone);
  const more = items.length > 1 ? ` +${items.length - 1}` : '';
  const title = event.title.length > 24 ? `${event.title.slice(0, 23).trimEnd()}…` : event.title;
  const prefix = `${when} ${title}: you owe `;
  const room = MAX_WRIST_CHARS - prefix.length - more.length;
  const first = items[0]!.what;
  return `${prefix}${first.length <= room ? first : `${first.slice(0, Math.max(1, room - 1)).trimEnd()}…`}${more}`;
}

export interface RecapResult {
  event: CalendarEvent;
  items: StoredCommitment[];
  text: string;
  todoId: string | null;
}

export interface RecapOptions {
  timezone: string;
  /** Send the recap this long before the meeting starts. */
  leadMs?: number;
  /** Re-read today's calendar this often. */
  refreshMs?: number;
}

/**
 * F3 pre-meeting recap: shortly before a calendar event, put the open promises
 * to the people in that meeting on the wrist. Silent when there is nothing owed.
 */
export class RecapScheduler {
  private events: CalendarEvent[] = [];
  private loadedAt = 0;
  private readonly leadMs: number;
  private readonly refreshMs: number;

  constructor(
    private readonly loadToday: () => Promise<unknown | null>,
    private readonly client: BeeClient,
    private readonly store: Store,
    private readonly opts: RecapOptions,
  ) {
    this.leadMs = opts.leadMs ?? 10 * 60_000;
    this.refreshMs = opts.refreshMs ?? 15 * 60_000;
  }

  async tick(now = new Date()): Promise<RecapResult[]> {
    if (now.getTime() - this.loadedAt >= this.refreshMs) {
      const raw = await this.loadToday();
      if (raw !== null) this.events = parseCalendarEvents(raw);
      this.loadedAt = now.getTime();
    }
    const results: RecapResult[] = [];
    for (const event of this.events) {
      const start = event.start.getTime();
      const key = `recap.${event.id}.${start}`;
      if (now.getTime() < start - this.leadMs || now.getTime() >= start || this.store.get(key)) continue;
      this.store.set(key, String(now.getTime()));
      const items = relevantCommitments(event, this.store.listCommitments(['open']));
      if (items.length === 0) continue;
      const text = recapText(event, items, now, this.opts.timezone);
      const todo = await this.client.createTodo({ text, alarmAt: new Date(now.getTime() + 30_000) });
      results.push({ event, items, text, todoId: String(todo.id) });
    }
    return results;
  }
}
