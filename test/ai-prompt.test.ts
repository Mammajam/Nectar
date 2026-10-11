import { describe, expect, it } from 'vitest';
import { buildUserMessage, describeNow } from '../src/ai/prompt.js';

describe('prompt', () => {
  it('describes now with weekday and offset in the user timezone', () => {
    const d = new Date('2026-10-12T09:30:00Z');
    expect(describeNow(d, 'Africa/Monrovia')).toBe('Monday 2026-10-12 09:30, Africa/Monrovia, UTC+00:00');
    expect(describeNow(d, 'America/New_York')).toBe('Monday 2026-10-12 05:30, America/New_York, UTC-04:00');
  });

  it('includes transcript lines, facts and brief', () => {
    const msg = buildUserMessage(
      { conversationId: 'c', utterances: [{ speaker: 'me', text: "I'll call Musa" }, { speaker: null, text: 'ok' }], startedAt: 0, endedAt: 0 },
      { facts: ['Musa is my supplier'], today: '10:00 Meeting with Fatu' },
      new Date('2026-10-12T09:30:00Z'),
      'Africa/Monrovia',
    );
    expect(msg).toContain("[me] I'll call Musa");
    expect(msg).toContain('[unknown] ok');
    expect(msg).toContain('- Musa is my supplier');
    expect(msg).toContain('10:00 Meeting with Fatu');
    expect(msg).toContain('CURRENT TIME: Monday 2026-10-12 09:30');
  });
});
