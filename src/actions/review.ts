import type { BeeClient } from '../bee/client.js';
import { BeeApiError } from '../bee/client.js';
import type { StoredCommitment, Store } from '../store/db.js';
import { overlap } from '../util/text.js';
import { atLocal, localDateKey, localParts, sameLocalDay } from '../util/time.js';
import { MAX_WRIST_CHARS } from './schedule.js';

export const REVIEW_LAST_KEY = 'review.lastDate';

export interface ReviewOptions {
  timezone: string;
  workdayStartHour?: number;
  leadMs?: number;
  /** Put a summary to-do on the wrist. */
  notify?: boolean;
  /** Only report; change nothing in Bee or the store. */
  dryRun?: boolean;
}

export interface ReviewReport {
  date: string;
  kept: StoredCommitment[];
  open: StoredCommitment[];
  carriedOver: StoredCommitment[];
  /** Open items the daily summary suggests may already be done. */
  maybeDone: StoredCommitment[];
  summary: string;
  summaryTodoId: string | null;
}

/** "Nectar: 3/4 kept today. Open: Send Musa the price list" in at most 80 chars. */
export function reviewSummary(kept: number, total: number, open: StoredCommitment[]): string {
  const head = total === 0 ? 'Nectar: no promises today' : `Nectar: ${kept}/${total} kept today`;
  if (open.length === 0) return total === 0 ? head : `${head}. All done!`;
  const first = open[0]!.what;
  const more = open.length > 1 ? ` +${open.length - 1}` : '';
  const prefix = `${head}. Open: `;
  const room = MAX_WRIST_CHARS - prefix.length - more.length;
  return `${prefix}${first.length <= room ? first : `${first.slice(0, room - 1).trimEnd()}…`}${more}`;
}

/** F4: end-of-day review. Syncs completion from Bee, carries over what's undone, and reports. */
export class EveningReview {
  constructor(
    private readonly client: BeeClient,
    private readonly store: Store,
    private readonly opts: ReviewOptions,
  ) {}

  async run(now = new Date()): Promise<ReviewReport> {
    const tz = this.opts.timezone;
    const dry = this.opts.dryRun ?? false;

    // 1. Pull completion state from Bee (to-dos ticked off on the phone or watch).
    for (const c of this.store.listCommitments(['open'])) {
      if (!c.beeTodoId) continue;
      try {
        const todo = await this.client.getTodo(c.beeTodoId);
        if (todo.completed && !dry) this.store.markDone(c.id, 'bee-app', now.getTime());
      } catch (err) {
        if (err instanceof BeeApiError && err.status === 404 && !dry) this.store.setStatus(c.id, 'dismissed');
      }
    }

    const all = this.store.listCommitments(['open', 'done']);
    const endOfToday = atLocal(now, tz, { addDays: 1, hour: 0 }).getTime();
    const dueByToday = (c: StoredCommitment) => {
      const due = c.scheduledDueAt ?? (c.dueAt ? Date.parse(c.dueAt) : null);
      return due !== null && due < endOfToday;
    };
    const kept = all.filter((c) => c.status === 'done' && c.doneAt !== null && sameLocalDay(new Date(c.doneAt), now, tz));
    const open = all.filter((c) => c.status === 'open' && dueByToday(c));

    // 2. Hint from Bee's daily summary: open items that sound done.
    let maybeDone: StoredCommitment[] = [];
    try {
      const daily = await this.client.listDaily({ limit: 1 });
      const d = daily.items[0];
      const text = d ? String(d.summary ?? d.text ?? d.content ?? JSON.stringify(d)) : '';
      if (text) maybeDone = open.filter((c) => overlap(c.what, text) >= 0.75);
    } catch {
      /* daily summary is optional */
    }

    // 3. Carry over: everything still open moves to tomorrow's first work hour.
    const carriedOver: StoredCommitment[] = [];
    const tomorrow = atLocal(now, tz, { addDays: 1, hour: this.opts.workdayStartHour ?? 9 });
    for (const c of open) {
      if (dry) {
        carriedOver.push(c);
        continue;
      }
      try {
        if (c.beeTodoId) await this.client.updateTodo(c.beeTodoId, { alarmAt: tomorrow });
        this.store.reschedule(c.id, new Date(tomorrow.getTime() + (this.opts.leadMs ?? 10 * 60_000)), tomorrow);
        carriedOver.push(c);
      } catch {
        /* leave it as is; it shows up again tomorrow */
      }
    }

    // 4. Summary on the wrist.
    const summary = reviewSummary(kept.length, kept.length + open.length, open);
    let summaryTodoId: string | null = null;
    if (this.opts.notify && !dry && kept.length + open.length > 0) {
      try {
        const todo = await this.client.createTodo({ text: summary, alarmAt: new Date(now.getTime() + 60_000) });
        summaryTodoId = String(todo.id);
      } catch {
        /* the log still has it */
      }
    }

    const date = localDateKey(now, tz);
    if (!dry) this.store.set(REVIEW_LAST_KEY, date);
    return { date, kept, open, carriedOver, maybeDone, summary, summaryTodoId };
  }
}

/** True once per local day, at or after the review time ("18:00"). */
export function reviewDue(now: Date, reviewTime: string, timezone: string, lastDate: string | null): boolean {
  const m = reviewTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return false;
  const p = localParts(now, timezone);
  const minutes = p.hour * 60 + p.minute;
  return minutes >= Number(m[1]) * 60 + Number(m[2]) && lastDate !== localDateKey(now, timezone);
}
