import { describe, expect, it } from 'vitest';
import { scoreCase } from '../src/ai/evaluate.js';

const c = (what: string, who: string | null, dueAt: string | null) => ({ what, who, dueAt, dueText: null, confidence: 0.9, quote: '' });

describe('scoreCase', () => {
  it('matches by keywords, person and local date', () => {
    const s = scoreCase(
      [{ keywords: ['order'], who: 'musa', dueDate: '2026-10-12' }],
      [c('Send Musa the updated order', 'Musa', '2026-10-12T15:00:00Z')],
      'Africa/Monrovia',
    );
    expect(s).toMatchObject({ matched: 1, missed: [], falsePositives: [], dateErrors: 0 });
  });

  it('counts wrong dates, misses and extras', () => {
    const s = scoreCase(
      [{ keywords: ['receipt'], who: null, dueDate: '2026-10-13' }, { keywords: ['driver'], who: null, dueDate: null }],
      [c('Bring the receipt', null, '2026-10-14T09:00:00Z'), c('Buy lunch', null, null)],
      'Africa/Monrovia',
    );
    expect(s.matched).toBe(0);
    expect(s.dateErrors).toBe(1);
    expect(s.missed).toHaveLength(2);
    expect(s.falsePositives.map((f) => f.what)).toEqual(['Buy lunch']);
  });
});
