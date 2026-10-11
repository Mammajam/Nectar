import { describe, expect, it } from 'vitest';
import { CommitmentExtractor } from '../src/ai/extractor.js';
import type { ContextProvider } from '../src/ai/context.js';
import type { StructuredLlm } from '../src/ai/types.js';
import { UtteranceWindower } from '../src/ai/windowing.js';
import { classifyEvent } from '../src/bee/types.js';
import { CommitmentPipeline, type PipelineResult } from '../src/pipeline.js';
import { Store } from '../src/store/db.js';

const llm: StructuredLlm = {
  modelId: 'fake',
  async structured(req) {
    const promise = req.user.includes("I'll send Musa the price list");
    return {
      commitments: promise
        ? [
            { who: 'Musa', what: 'Send Musa the price list', dueText: 'by 3 PM', dueAt: '2026-10-12T15:00:00Z', confidence: 0.95, quote: 'q' },
            { who: null, what: 'Maybe tidy the shop', dueText: null, dueAt: null, confidence: 0.5, quote: 'q' },
          ]
        : [],
    };
  },
};
const context: ContextProvider = { get: async () => ({ facts: [], today: null }), close: async () => {} };
const utt = (text: string) => classifyEvent({ utterance: { text, speaker: 'me' }, conversation_id: 'c1' });

describe('CommitmentPipeline', () => {
  it('turns a window into open and suggested commitments and skips repeats', async () => {
    const store = new Store(':memory:');
    const results: PipelineResult[] = [];
    const p = new CommitmentPipeline(
      new UtteranceWindower({ pauseMs: 100, overlap: 0 }),
      new CommitmentExtractor(llm, { timezone: 'UTC' }),
      context,
      store,
      { onResult: (r) => results.push(r) },
    );
    p.onEvent(utt("I'll send Musa the price list by 3 PM"), 0);
    p.tick(200);
    p.onEvent(utt("Again: I'll send Musa the price list by 3 PM"), 300);
    await p.drain(1000);

    expect(results[0]!.saved.map((s) => s.status)).toEqual(['open', 'suggested']);
    expect(results[1]!.skippedDuplicates).toBe(2);
    const stored = store.listCommitments(['open', 'suggested']);
    expect(stored.map((c) => [c.what, c.status, c.conversationId])).toEqual([
      ['Send Musa the price list', 'open', 'c1'],
      ['Maybe tidy the shop', 'suggested', 'c1'],
    ]);
    expect(stored[0]!.dueAt).toBe('2026-10-12T15:00:00.000Z');
  });

  it('keeps going when the context provider fails', async () => {
    const store = new Store(':memory:');
    const broken: ContextProvider = { get: async () => { throw new Error('mcp down'); }, close: async () => {} };
    const p = new CommitmentPipeline(new UtteranceWindower({ pauseMs: 10 }), new CommitmentExtractor(llm, { timezone: 'UTC' }), broken, store);
    p.onEvent(utt("I'll send Musa the price list"), 0);
    await p.drain(100);
    expect(store.listCommitments(['open'])).toHaveLength(1);
  });
});
