import type { BeeClient } from '../bee/client.js';
import type { BeeCli } from '../bee/cli.js';
import type { BeeTodo } from '../bee/types.js';
import type { StoredCommitment, Store } from '../store/db.js';
import { overlap } from '../util/text.js';
import { scheduleCommitment, wristText, type ScheduleOptions } from './schedule.js';

export interface ScheduledResult {
  commitment: StoredCommitment;
  outcome: 'created' | 'linked-existing' | 'accepted-suggestion' | 'deferred' | 'failed';
  todoId: string | null;
  text: string;
  dueAt: Date;
  alarmAt: Date;
  source: string;
  error?: unknown;
}

export interface TodoSchedulerOptions extends ScheduleOptions {
  /** Token overlap at or above which an existing Bee to-do counts as the same task. */
  matchThreshold?: number;
  /** How far back a voice note's `aiResponse.todos` still counts as Bee's own to-do. */
  journalLookbackMs?: number;
  /** How long to wait for Bee to create a to-do it announced in a voice note before creating ours. */
  journalGraceMs?: number;
  now?: () => Date;
}

/**
 * F2: turn open commitments into Bee to-dos with alarms. Before creating one,
 * it checks open Bee to-dos and Bee's own suggestions so the wrist never shows
 * the same task twice.
 */
export class TodoScheduler {
  private readonly now: () => Date;
  private readonly matchThreshold: number;
  private running: Promise<ScheduledResult[]> = Promise.resolve([]);

  constructor(
    private readonly client: BeeClient,
    private readonly cli: BeeCli | null,
    private readonly store: Store,
    private readonly opts: TodoSchedulerOptions,
  ) {
    this.now = opts.now ?? (() => new Date());
    this.matchThreshold = opts.matchThreshold ?? 0.75;
  }

  /** Schedule every open commitment without a to-do. Calls are serialized. */
  scheduleAll(): Promise<ScheduledResult[]> {
    this.running = this.running.then(() => this.run(), () => this.run());
    return this.running;
  }

  private async run(): Promise<ScheduledResult[]> {
    const pending = this.store.unscheduled();
    if (pending.length === 0) return [];
    let openTodos: BeeTodo[] = [];
    try {
      openTodos = (await this.client.listTodos({ limit: 100 })).items.filter((t) => !t.completed);
    } catch {
      /* creating is still better than skipping */
    }
    const suggestions = this.cli ? await this.cli.todoSuggestions() : [];

    const results: ScheduledResult[] = [];
    for (const c of pending) {
      const now = this.now();
      const s = scheduleCommitment(c, now, this.opts);
      const text = wristText(c, s.dueAt, now, this.opts.timezone);
      const base = { commitment: c, text, dueAt: s.dueAt, alarmAt: s.alarmAt, source: s.source };
      try {
        const existing = openTodos.find((t) => overlap(t.text, c.what) >= this.matchThreshold);
        if (existing) {
          await this.client.updateTodo(existing.id, { alarmAt: s.alarmAt });
          this.store.markScheduled(c.id, String(existing.id), s.dueAt, s.alarmAt);
          results.push({ ...base, outcome: 'linked-existing', todoId: String(existing.id) });
          continue;
        }
        // Bee may have created its own to-do from a voice note (`aiResponse.todos`).
        const announced = this.store
          .recentJournalTodos(now.getTime() - (this.opts.journalLookbackMs ?? 24 * 3_600_000))
          .filter((j) => overlap(j.text, c.what) >= this.matchThreshold);
        if (announced.length) {
          const theirs = openTodos.find((t) => announced.some((j) => overlap(t.text, j.text) >= this.matchThreshold));
          if (theirs) {
            await this.client.updateTodo(theirs.id, { alarmAt: s.alarmAt });
            this.store.markScheduled(c.id, String(theirs.id), s.dueAt, s.alarmAt);
            results.push({ ...base, outcome: 'linked-existing', todoId: String(theirs.id) });
            continue;
          }
          // Not in the list yet: give Bee a moment before adding a second to-do.
          const newest = Math.max(...announced.map((j) => j.receivedAt));
          if (now.getTime() - newest < (this.opts.journalGraceMs ?? 120_000)) {
            results.push({ ...base, outcome: 'deferred', todoId: null });
            continue;
          }
        }
        const suggestion = suggestions.find((x) => overlap(x.text, c.what) >= this.matchThreshold);
        if (suggestion && this.cli) {
          const acceptedId = await this.cli.acceptSuggestion(suggestion.id);
          if (acceptedId !== null) {
            await this.client.updateTodo(acceptedId, { text, alarmAt: s.alarmAt });
            this.store.markScheduled(c.id, String(acceptedId), s.dueAt, s.alarmAt);
            results.push({ ...base, outcome: 'accepted-suggestion', todoId: String(acceptedId) });
            continue;
          }
        }
        const todo = await this.client.createTodo({ text, alarmAt: s.alarmAt });
        this.store.markScheduled(c.id, String(todo.id), s.dueAt, s.alarmAt);
        openTodos.push(todo);
        results.push({ ...base, outcome: 'created', todoId: String(todo.id) });
      } catch (error) {
        results.push({ ...base, outcome: 'failed', todoId: null, error });
      }
    }
    return results;
  }
}
