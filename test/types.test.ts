import { describe, expect, it } from 'vitest';
import { classifyEvent } from '../src/bee/types.js';

describe('classifyEvent', () => {
  it('detects an utterance by its structural key and finds the conversation id', () => {
    const e = classifyEvent({ utterance: { id: 7, text: "I'll send it Friday", conversation_id: 42 } });
    expect(e.kind).toBe('utterance');
    if (e.kind === 'utterance') {
      expect(e.utterance.text).toBe("I'll send it Friday");
      expect(e.conversationId).toBe('42');
    }
  });

  it('falls back to a top-level or nested conversation id', () => {
    const a = classifyEvent({ utterance: { text: 'hi' }, conversation_id: 'c1' });
    const b = classifyEvent({ utterance: { text: 'hi' }, conversation: { id: 9 } });
    expect(a.kind === 'utterance' && a.conversationId).toBe('c1');
    expect(b.kind === 'utterance' && b.conversationId).toBe('9');
  });

  it('classifies todos, conversations, journals and connection events', () => {
    expect(classifyEvent({ todo: { id: 1, text: 'x' } }).kind).toBe('todo');
    expect(classifyEvent({ conversation: { id: 1, title: 't' } }).kind).toBe('conversation');
    const j = classifyEvent({ text: 'done with the invoice' }, 'journal-text');
    expect(j.kind).toBe('journal');
    expect(j.kind === 'journal' && j.text).toBe('done with the invoice');
    expect(classifyEvent({}, 'connected').kind).toBe('connected');
  });

  it('keeps unknown payloads instead of throwing', () => {
    const e = classifyEvent('plain text', 'mystery');
    expect(e.kind).toBe('unknown');
    expect(e.kind === 'unknown' && e.name).toBe('mystery');
  });
});
