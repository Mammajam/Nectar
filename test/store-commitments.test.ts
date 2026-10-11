import { describe, expect, it } from 'vitest';
import { Store } from '../src/store/db.js';

describe('Store commitments', () => {
  it('inserts, lists by due time and finds similar', () => {
    const s = new Store(':memory:');
    const base = { who: 'Musa', dueText: null, confidence: 0.9, quote: 'q' };
    s.insertCommitment({ ...base, what: 'Later task', dueAt: null }, 'c1', 'open');
    s.insertCommitment({ ...base, what: 'Send price list', dueAt: '2026-10-12T15:00:00Z' }, 'c1', 'open');
    s.insertCommitment({ ...base, what: 'Maybe', dueAt: null }, 'c1', 'suggested');
    expect(s.listCommitments().map((c) => c.what)).toEqual(['Send price list', 'Later task']);
    expect(s.listCommitments(['suggested'])).toHaveLength(1);
    expect(s.findSimilarCommitment('send the price list'.replace('the ', ''), 'c1')?.what).toBe('Send price list');
    expect(s.findSimilarCommitment('Send price list', 'other')).toBeNull();
  });
});
