import { describe, expect, it } from 'vitest';
import { classifyEvent } from '../src/bee/types.js';
import { Store } from '../src/store/db.js';

describe('Store', () => {
  it('stores an utterance once even if seen twice', () => {
    const s = new Store(':memory:');
    const e = classifyEvent({ utterance: { text: "I'll call you back", start: 1, speaker: 'me' }, conversation_id: 'c1' });
    expect(s.insertEvent(e)).toBe(true);
    expect(s.insertEvent(e)).toBe(false);
    expect(s.countEvents('utterance')).toBe(1);
    expect(s.utterances('c1').map((u) => u.text)).toEqual(["I'll call you back"]);
  });

  it('uses the Bee utterance id for dedupe when present', () => {
    const s = new Store(':memory:');
    s.insertEvent(classifyEvent({ utterance: { id: 9, text: 'a' }, conversation_id: 'c' }));
    expect(s.insertEvent(classifyEvent({ utterance: { id: 9, text: 'a (edited)' }, conversation_id: 'c' }))).toBe(false);
  });

  it('ignores connection events and round-trips kv values', () => {
    const s = new Store(':memory:');
    expect(s.insertEvent(classifyEvent({}, 'connected'))).toBe(false);
    expect(s.get('k')).toBeNull();
    s.set('k', 'v1');
    s.set('k', 'v2');
    expect(s.get('k')).toBe('v2');
  });
});
