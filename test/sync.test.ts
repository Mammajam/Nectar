import { describe, expect, it } from 'vitest';
import type { BeeClient } from '../src/bee/client.js';
import { CHANGES_CURSOR_KEY, catchUp, utterancesOf } from '../src/bee/sync.js';
import { Store } from '../src/store/db.js';

function fakeClient(): { client: BeeClient; cursors: (string | null | undefined)[] } {
  const cursors: (string | null | undefined)[] = [];
  const client = {
    async changes(cursor?: string | null) {
      cursors.push(cursor);
      return {
        changes: [{ type: 'conversation', id: 'c1' }, { type: 'todo', id: 't1' }, { type: 'conversation', id: 'c1' }],
        cursor: 'cursor-2',
        raw: {},
      };
    },
    async getConversation(id: string) {
      return {
        id,
        utterances: [
          { id: 'u1', text: "I'll send the invoice Friday" },
          { id: 'u2', text: 'Thanks' },
        ],
      };
    },
  } as unknown as BeeClient;
  return { client, cursors };
}

describe('catchUp', () => {
  it('fetches each changed conversation once, stores utterances and saves the cursor', async () => {
    const store = new Store(':memory:');
    const { client, cursors } = fakeClient();
    const r = await catchUp(client, store);
    expect(r).toMatchObject({ changesSeen: 3, conversationsFetched: 1, newUtterances: 2, cursor: 'cursor-2' });
    expect(store.get(CHANGES_CURSOR_KEY)).toBe('cursor-2');
    expect(cursors[0]).toBeNull();
  });

  it('reports each new utterance to the callback', async () => {
    const store = new Store(':memory:');
    const seen: string[] = [];
    await catchUp(fakeClient().client, store, (e) => {
      if (e.kind === 'utterance') seen.push(e.utterance.text);
    });
    expect(seen).toEqual(["I'll send the invoice Friday", 'Thanks']);
  });

  it('is idempotent and resumes from the saved cursor', async () => {
    const store = new Store(':memory:');
    const { client, cursors } = fakeClient();
    await catchUp(client, store);
    const second = await catchUp(client, store);
    expect(second.newUtterances).toBe(0);
    expect(cursors[1]).toBe('cursor-2');
    expect(store.countEvents('utterance')).toBe(2);
  });
});

describe('utterancesOf', () => {
  it('handles direct, transcript-object and transcript-array shapes', () => {
    expect(utterancesOf({ utterances: [{ text: 'a' }] })).toHaveLength(1);
    expect(utterancesOf({ transcript: { utterances: [{ text: 'a' }, { text: 'b' }] } })).toHaveLength(2);
    expect(utterancesOf({ transcript: [{ text: 'a' }] })).toHaveLength(1);
    expect(utterancesOf(null)).toEqual([]);
  });
});
