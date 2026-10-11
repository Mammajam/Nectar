import { describe, expect, it } from 'vitest';
import { UtteranceWindower } from '../src/ai/windowing.js';
import { classifyEvent } from '../src/bee/types.js';

const utt = (text: string, conv = 'c1', speaker = 'me') => classifyEvent({ utterance: { text, speaker }, conversation_id: conv });

describe('UtteranceWindower', () => {
  it('releases a window after the pause, per conversation', () => {
    const w = new UtteranceWindower({ pauseMs: 1000, overlap: 0 });
    w.add(utt('a'), 0);
    w.add(utt('b', 'c2'), 500);
    expect(w.tick(900)).toEqual([]);
    const first = w.tick(1000);
    expect(first.map((x) => x.conversationId)).toEqual(['c1']);
    expect(first[0]!.utterances.map((u) => u.text)).toEqual(['a']);
    expect(w.tick(1500).map((x) => x.conversationId)).toEqual(['c2']);
  });

  it('flushes early at max size and carries overlap lines into the next window', () => {
    const w = new UtteranceWindower({ pauseMs: 1000, maxUtterances: 3, overlap: 2 });
    w.add(utt('1'), 0);
    w.add(utt('2'), 1);
    const out = w.add(utt('3'), 2);
    expect(out[0]!.utterances.map((u) => u.text)).toEqual(['1', '2', '3']);
    // Only carried lines remain: nothing new to analyze yet.
    expect(w.tick(5000)).toEqual([]);
    w.add(utt('4'), 5001);
    expect(w.tick(7000)[0]!.utterances.map((u) => u.text)).toEqual(['2', '3', '4']);
  });

  it('ignores non-utterance and empty events; flushAll releases pending', () => {
    const w = new UtteranceWindower();
    expect(w.add(classifyEvent({ todo: { id: 1, text: 'x' } }))).toEqual([]);
    expect(w.add(utt('   '))).toEqual([]);
    w.add(utt('pending'));
    expect(w.flushAll()).toHaveLength(1);
    expect(w.flushAll()).toHaveLength(0);
  });
});
