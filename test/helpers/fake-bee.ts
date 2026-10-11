import type { BeeClient } from '../../src/bee/client.js';
import { BeeApiError } from '../../src/bee/client.js';
import type { BeeTodo } from '../../src/bee/types.js';

/** In-memory stand-in for the Bee proxy API, recording every write. */
export class FakeBee {
  todos = new Map<string, BeeTodo>();
  daily: Record<string, unknown>[] = [];
  writes: { op: string; id?: string; body: unknown }[] = [];
  private next = 1;

  asClient(): BeeClient {
    const self = this;
    return {
      async listTodos() {
        return { items: [...self.todos.values()], nextCursor: null, raw: null };
      },
      async getTodo(id: string | number) {
        const t = self.todos.get(String(id));
        if (!t) throw new BeeApiError(404, 'GET', `/v1/todos/${id}`, 'not found');
        return t;
      },
      async createTodo(input: { text: string; alarmAt?: Date | null }) {
        const id = `t${self.next++}`;
        const todo: BeeTodo = { id, text: input.text, completed: false, alarm_at: input.alarmAt?.getTime() ?? null };
        self.todos.set(id, todo);
        self.writes.push({ op: 'create', id, body: input });
        return todo;
      },
      async updateTodo(id: string | number, input: { text?: string; completed?: boolean; alarmAt?: Date | null }) {
        const t = self.todos.get(String(id));
        if (!t) throw new BeeApiError(404, 'PUT', `/v1/todos/${id}`, 'not found');
        if (input.text !== undefined) t.text = input.text;
        if (input.completed !== undefined) t.completed = input.completed;
        if (input.alarmAt !== undefined) t.alarm_at = input.alarmAt?.getTime() ?? null;
        self.writes.push({ op: 'update', id: String(id), body: input });
        return t;
      },
      async completeTodo(id: string | number) {
        return this.updateTodo(id, { completed: true });
      },
      async listDaily() {
        return { items: self.daily, nextCursor: null, raw: null };
      },
    } as unknown as BeeClient;
  }
}
