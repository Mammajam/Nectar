import type { ReviewReport } from './review.js';
import type { ScheduledResult } from './scheduler.js';
import { shortWhen } from '../util/time.js';

export function describeScheduled(r: ScheduledResult, now: Date, timezone: string): string {
  if (r.outcome === 'failed') {
    return `[todo failed] ${r.commitment.what}: ${r.error instanceof Error ? r.error.message : String(r.error)}`;
  }
  if (r.outcome === 'deferred') return `[todo waiting] "${r.commitment.what}": Bee announced the same to-do from a voice note`;
  const label = { created: 'todo created', 'linked-existing': 'todo linked', 'accepted-suggestion': 'suggestion accepted' }[r.outcome];
  return `[${label}] "${r.text}" alarm ${shortWhen(r.alarmAt, now, timezone)} (time from ${r.source})`;
}

export function describeReview(r: ReviewReport): string[] {
  const lines = [`[review ${r.date}] ${r.summary}`];
  for (const c of r.kept) lines.push(`   kept: ${c.what}${c.doneVia ? ` (${c.doneVia})` : ''}`);
  for (const c of r.carriedOver) lines.push(`   carried to tomorrow: ${c.what}`);
  for (const c of r.maybeDone) lines.push(`   may be done (daily summary mentions it): ${c.what}`);
  if (r.summaryTodoId) lines.push(`   summary sent to the wrist as to-do ${r.summaryTodoId}`);
  return lines;
}
