import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { toPage } from './client.js';
import type { BeeId } from './types.js';

const run = promisify(execFile);

export interface TodoSuggestion {
  id: BeeId;
  text: string;
}

/**
 * Bee CLI commands that have no documented REST route (todo suggestions).
 * Every call fails soft: suggestions are an enhancement, not a dependency.
 */
export class BeeCli {
  constructor(
    private readonly beeBin: string,
    private readonly exec: (cmd: string, args: string[]) => Promise<{ stdout: string }> = (cmd, args) =>
      run(cmd, args, { timeout: 15_000 }),
  ) {}

  async todoSuggestions(limit = 20): Promise<TodoSuggestion[]> {
    try {
      const { stdout } = await this.exec(this.beeBin, ['todos', 'suggestions', '--limit', String(limit), '--json']);
      const page = toPage<Record<string, unknown>>(JSON.parse(stdout), 'suggestions');
      return page.items
        .map((s) => ({ id: s.id as BeeId, text: String(s.text ?? s.title ?? '') }))
        .filter((s) => (typeof s.id === 'string' || typeof s.id === 'number') && s.text);
    } catch {
      return [];
    }
  }

  /** Today's brief (calendar events, emails) as raw JSON, or null if unavailable. */
  async today(): Promise<unknown | null> {
    try {
      const { stdout } = await this.exec(this.beeBin, ['today', '--json']);
      return JSON.parse(stdout) as unknown;
    } catch {
      return null;
    }
  }

  async acceptSuggestion(id: BeeId): Promise<BeeId | null> {
    try {
      const { stdout } = await this.exec(this.beeBin, ['todos', 'accept-suggestion', String(id), '--json']);
      const out = JSON.parse(stdout) as Record<string, unknown>;
      const todo = (out.todo ?? out) as Record<string, unknown>;
      return (todo.id as BeeId | undefined) ?? null;
    } catch {
      return null;
    }
  }
}
