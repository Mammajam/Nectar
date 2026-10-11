import { describe, expect, it } from 'vitest';
import { CommitmentExtractor, dedupeCommitments, parseCommitments } from '../src/ai/extractor.js';
import type { StructuredLlm, StructuredRequest } from '../src/ai/types.js';

const fakeLlm = (output: unknown) => {
  const calls: StructuredRequest[] = [];
  const llm: StructuredLlm = { modelId: 'fake', structured: async (r) => (calls.push(r), output) };
  return { llm, calls };
};

const window = { conversationId: 'c1', utterances: [{ speaker: 'me', text: "I'll send it by 3" }], startedAt: 0, endedAt: 0 };

describe('parseCommitments', () => {
  it('keeps valid items, normalizes dates and clamps confidence', () => {
    const out = parseCommitments({
      commitments: [
        { who: 'Musa', what: 'Send price list', dueText: 'by 3 PM', dueAt: '2026-10-12T15:00:00+00:00', confidence: 1.4, quote: 'q' },
        { who: null, what: 'Call back', dueText: null, dueAt: 'not a date', confidence: 0.8, quote: '' },
        { what: '', confidence: 0.9 },
        { what: 'No confidence' },
        'garbage',
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ who: 'Musa', dueAt: '2026-10-12T15:00:00.000Z', confidence: 1 });
    expect(out[1]).toMatchObject({ dueAt: null, quote: 'Call back' });
  });

  it('returns [] for malformed tool input', () => {
    expect(parseCommitments(null)).toEqual([]);
    expect(parseCommitments({ commitments: 'x' })).toEqual([]);
  });

  it('dedupes the same action, keeping the most confident', () => {
    const base = { who: null, dueText: null, dueAt: null, quote: '' };
    const out = dedupeCommitments([
      { ...base, what: 'Send the price list', confidence: 0.6 },
      { ...base, what: 'send the price-list!', confidence: 0.6 },
      { ...base, what: 'Send the price list', confidence: 0.9 },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('CommitmentExtractor', () => {
  it('calls the model with the forced tool and filters low confidence', async () => {
    const { llm, calls } = fakeLlm({
      commitments: [
        { who: 'Musa', what: 'Send price list', dueText: null, dueAt: null, confidence: 0.9, quote: 'q' },
        { who: null, what: 'Maybe call', dueText: null, dueAt: null, confidence: 0.2, quote: 'q' },
      ],
    });
    const ex = new CommitmentExtractor(llm, { timezone: 'Africa/Monrovia', now: () => new Date('2026-10-12T09:30:00Z') });
    const out = await ex.extract(window, { facts: ['Musa is my supplier'], today: null });
    expect(out.map((c) => c.what)).toEqual(['Send price list']);
    expect(calls[0]!.tool.name).toBe('record_commitments');
    expect(calls[0]!.user).toContain('Monday 2026-10-12 09:30');
  });

  it('skips the model for empty windows', async () => {
    const { llm, calls } = fakeLlm({ commitments: [] });
    const ex = new CommitmentExtractor(llm, { timezone: 'UTC' });
    expect(await ex.extract({ ...window, utterances: [] })).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
