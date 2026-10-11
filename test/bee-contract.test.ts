import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { CloseOutHandler } from '../src/actions/closeout.js';
import { TodoScheduler } from '../src/actions/scheduler.js';
import { CommitmentExtractor } from '../src/ai/extractor.js';
import type { ContextProvider } from '../src/ai/context.js';
import type { StructuredLlm } from '../src/ai/types.js';
import { UtteranceWindower } from '../src/ai/windowing.js';
import { toChangesPage, type BeeClient } from '../src/bee/client.js';
import { CHANGES_CURSOR_KEY, catchUp } from '../src/bee/sync.js';
import { CliStreamSource } from '../src/bee/stream.js';
import { classifyEvent, type BeeEvent } from '../src/bee/types.js';
import { CommitmentPipeline } from '../src/pipeline.js';
import { Store } from '../src/store/db.js';
import { FakeBee } from './helpers/fake-bee.js';

type Entry = { source: string; payload: Record<string, unknown> };
const docs = JSON.parse(readFileSync(new URL('./fixtures/bee-docs-payloads.json', import.meta.url), 'utf8')) as {
  stream: Record<string, Entry>;
  changefeed: Entry;
};
const UUID = '3f1c9a52-7d4e-4b1a-9c2e-5a6b7c8d9e01';
const stream = (name: string) => docs.stream[name]!.payload;

describe('documented stream payloads (JSON mode, no event name)', () => {
  it('every fixture cites its source page', () => {
    for (const e of [...Object.values(docs.stream), docs.changefeed]) expect(e.source).toMatch(/^https:\/\/docs\.bee\.computer\/docs\//);
  });

  it.each([
    ['new-utterance', 'utterance'],
    ['new-conversation', 'conversation'],
    ['update-conversation', 'conversation'],
    ['delete-conversation', 'conversation'],
    ['update-conversation-summary', 'ignored'],
    ['update-location', 'ignored'],
    ['todo-created', 'todo'],
    ['todo-updated', 'todo'],
    ['todo-deleted', 'todo'],
    ['journal-created', 'journal'],
    ['journal-updated', 'journal'],
    ['journal-deleted', 'journal'],
    ['journal-text', 'journal'],
  ])('%s classifies as %s', (name, kind) => {
    expect(classifyEvent(stream(name)).kind).toBe(kind);
  });

  it('no documented event is "unknown"', () => {
    for (const name of Object.keys(docs.stream)) expect(classifyEvent(stream(name)).kind).not.toBe('unknown');
  });

  it('ignorable events carry their documented names', () => {
    expect(classifyEvent(stream('update-conversation-summary'))).toMatchObject({ kind: 'ignored', name: 'update-conversation-summary' });
    expect(classifyEvent(stream('update-location'))).toMatchObject({ kind: 'ignored', name: 'update-location' });
  });

  it('keys an utterance by conversation_uuid', () => {
    expect(classifyEvent(stream('new-utterance'))).toMatchObject({ kind: 'utterance', conversationId: UUID });
  });

  it('reads journal-text {journalId, text} as a journal with its text', () => {
    expect(classifyEvent(stream('journal-text'))).toMatchObject({
      kind: 'journal',
      journalId: '991',
      text: 'Done with the price list for Musa',
    });
  });

  it('prefers aiResponse.cleanedUpText and exposes Bee-created to-dos on journal-updated', () => {
    expect(classifyEvent(stream('journal-created'))).toMatchObject({ text: 'um done with the price list for musa' });
    expect(classifyEvent(stream('journal-updated'))).toMatchObject({
      text: 'Done with the price list for Musa.',
      aiTodos: ['Call the landlord'],
    });
  });

  it('ignores journals that are not ready', () => {
    // READY is documented; the name of an in-progress state is not, so any other value counts as not ready.
    const j = { journal: { id: 5, state: 'PROCESSING', text: 'done with the price list' } };
    expect(classifyEvent(j)).toMatchObject({ kind: 'journal', text: null });
  });

  it('reads the todo alarmAt (epoch ms) from stream events', () => {
    const e = classifyEvent(stream('todo-created'));
    expect(e.kind === 'todo' && e.todo.alarmAt).toBe(1791818400000);
  });
});

describe('documented changefeed', () => {
  it('reads the cursor from meta.next_cursor and the keyed arrays', () => {
    const page = toChangesPage(docs.changefeed.payload);
    expect(page.cursor).toBe('v1-1770759786309');
    expect(page.changes).toEqual([
      { type: 'fact', id: 17 },
      { type: 'conversation', id: 4512, state: 'COMPLETED' },
      { type: 'conversation', id: 4513, state: 'CAPTURING' },
      { type: 'journal', id: 'j-991', state: 'READY' },
    ]);
  });

  it('still accepts an older top-level cursor', () => {
    expect(toChangesPage({ next_cursor: 'abc', changes: [] }).cursor).toBe('abc');
  });
});

describe('catch-up with the documented changefeed', () => {
  /** A client whose changefeed is the documented fixture; GET conversation is an undocumented shape. */
  function clientFor(opts: { uuid?: string } = {}) {
    const cursors: (string | null | undefined)[] = [];
    const fetched: string[] = [];
    const client = {
      async changes(cursor?: string | null) {
        cursors.push(cursor);
        return toChangesPage(cursor ? { meta: { next_cursor: cursor }, conversations: [] } : docs.changefeed.payload);
      },
      async getConversation(id: string | number) {
        fetched.push(String(id));
        return {
          id: Number(id),
          ...(opts.uuid ? { uuid: opts.uuid } : {}),
          utterances: [{ text: "I'll send Musa the price list by 3 PM", speaker: 'speaker_1' }],
        };
      },
    } as unknown as BeeClient;
    return { client, cursors, fetched };
  }

  it('saves the cursor, so the second catch-up sends it and fetches nothing', async () => {
    const store = new Store(':memory:');
    const { client, cursors, fetched } = clientFor();
    await catchUp(client, store);
    expect(store.get(CHANGES_CURSOR_KEY)).toBe('v1-1770759786309');
    const second = await catchUp(client, store);
    expect(cursors).toEqual([null, 'v1-1770759786309']);
    expect(second).toMatchObject({ conversationsFetched: 0, newUtterances: 0 });
    expect(fetched).toEqual(['4512']);
  });

  it('skips conversations that are not COMPLETED', async () => {
    const { client, fetched } = clientFor();
    const r = await catchUp(client, new Store(':memory:'));
    expect(fetched).not.toContain('4513');
    expect(r).toMatchObject({ conversationsFetched: 1, conversationsSkipped: 1 });
  });

  it('stores an utterance seen live and again in catch-up once, under the uuid', async () => {
    const store = new Store(':memory:');
    // The live conversation event teaches the id <-> uuid map; the live utterance carries the uuid.
    expect(store.insertEvent(classifyEvent(stream('new-conversation')))).toBe(true);
    expect(store.insertEvent(classifyEvent(stream('new-utterance')))).toBe(true);
    const seen: BeeEvent[] = [];
    const r = await catchUp(clientFor().client, store, (e) => seen.push(e));
    expect(r.newUtterances).toBe(0);
    expect(store.countEvents('utterance')).toBe(1);
    expect(store.utterances(UUID)).toHaveLength(1);
  });

  it('resolves the uuid from the API response when the map has none', async () => {
    const store = new Store(':memory:');
    await catchUp(clientFor({ uuid: UUID }).client, store);
    expect(store.uuidFor(4512)).toBe(UUID);
    expect(store.utterances(UUID)).toHaveLength(1);
    // The live copy of the same words is now a duplicate.
    expect(store.insertEvent(classifyEvent(stream('new-utterance')))).toBe(false);
  });

  it('falls back to the numeric id only when no uuid is known', async () => {
    const store = new Store(':memory:');
    await catchUp(clientFor().client, store);
    expect(store.utterances('4512')).toHaveLength(1);
  });

  it('rewrites numeric ids to the uuid once the link is learned, and still de-duplicates', async () => {
    const store = new Store(':memory:');
    await catchUp(clientFor().client, store); // stored under '4512'
    store.insertCommitment({ who: null, what: 'Send the list', dueText: null, dueAt: null, confidence: 0.9, quote: '' }, '4512', 'open');
    store.insertEvent(classifyEvent(stream('new-conversation'))); // learns 4512 <-> UUID
    expect(store.utterances('4512')).toHaveLength(0);
    expect(store.utterances(UUID)).toHaveLength(1);
    expect(store.listCommitments(['open'])[0]!.conversationId).toBe(UUID);
    expect(store.insertEvent(classifyEvent(stream('new-utterance')))).toBe(false);
  });
});

describe('two parallel conversations', () => {
  it('produce two separate windows', () => {
    const w = new UtteranceWindower({ pauseMs: 10, overlap: 0 });
    const u = (conversation_uuid: string, text: string) => classifyEvent({ utterance: { text, speaker: 's' }, conversation_uuid });
    w.add(u('aaaa', "I'll call Musa"), 0);
    w.add(u('bbbb', 'Lunch is ready'), 1);
    const windows = w.tick(100);
    expect(windows.map((x) => [x.conversationId, x.utterances.length])).toEqual([['aaaa', 1], ['bbbb', 1]]);
  });
});

describe('end to end in CLI stream mode, documented payloads only', () => {
  function fakeChild(lines: string[]) {
    const child = new EventEmitter() as ChildProcess & EventEmitter;
    const stdout = new PassThrough();
    Object.assign(child, { stdout, stderr: new PassThrough(), kill: () => true });
    setTimeout(() => {
      for (const l of lines) stdout.write(`${l}\n`);
      stdout.end();
      setTimeout(() => child.emit('close', 0), 5);
    }, 5);
    return child;
  }

  const llm: StructuredLlm = {
    modelId: 'fake',
    async structured(req) {
      return {
        commitments: req.user.includes("I'll send Musa the price list")
          ? [{ who: 'Musa', what: 'Send Musa the price list', dueText: 'by 3 PM', dueAt: '2026-10-12T15:00:00Z', confidence: 0.95, quote: 'q' }]
          : [],
      };
    },
  };
  const context: ContextProvider = { get: async () => ({ facts: [], today: null }), close: async () => {} };

  it('promise -> to-do with alarm -> voice close-out completes it', async () => {
    const bee = new FakeBee();
    const store = new Store(':memory:');
    const pipeline = new CommitmentPipeline(
      new UtteranceWindower({ pauseMs: 1, overlap: 0 }),
      new CommitmentExtractor(llm, { timezone: 'UTC' }),
      context,
      store,
    );
    const closeOut = new CloseOutHandler(bee.asClient(), store);
    const closed: string[] = [];

    const lines = [
      JSON.stringify(stream('new-conversation')),
      JSON.stringify(stream('update-location')),
      JSON.stringify(stream('new-utterance')),
      JSON.stringify(stream('update-conversation-summary')),
    ];
    let spawns = 0;
    const src = new CliStreamSource('bee', [], () => fakeChild(spawns++ === 0 ? lines : []), 5);
    const onEvent = async (event: BeeEvent) => {
      if (!store.insertEvent(event)) return;
      pipeline.onEvent(event, 0);
      if (event.kind === 'journal' || event.kind === 'todo') {
        const r = await closeOut.handle(event);
        if (r) closed.push(r.commitment.what);
      }
    };
    src.start({ onEvent });
    await new Promise((r) => setTimeout(r, 80));
    await src.stop();

    await pipeline.drain(1000);
    const scheduler = new TodoScheduler(bee.asClient(), null, store, { timezone: 'UTC', now: () => new Date('2026-10-12T09:30:00Z') });
    const [scheduled] = await scheduler.scheduleAll();
    expect(scheduled).toMatchObject({ outcome: 'created', text: 'Send Musa the price list · due 3 PM' });
    expect(store.listCommitments(['open'])[0]!.conversationId).toBe(UUID);

    // The user then records a voice note; in JSON mode it arrives as {journalId, text}.
    await onEvent(classifyEvent(stream('journal-text')));
    expect(closed).toEqual(['Send Musa the price list']);
    expect(bee.todos.get(scheduled!.todoId!)!.completed).toBe(true);
    expect(store.listCommitments(['done'])[0]).toMatchObject({ doneVia: 'voice' });
  });
});
