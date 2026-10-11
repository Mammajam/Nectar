import { describe, expect, it } from 'vitest';
import type { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { BedrockStructuredLlm, type ConverseSender } from '../src/ai/bedrock.js';

const req = {
  system: 'sys',
  user: 'hello',
  tool: { name: 'record_commitments', description: 'd', schema: { type: 'object' } },
};

function sender(responses: (object | Error)[]) {
  const sent: ConverseCommand[] = [];
  const s: ConverseSender = {
    async send(cmd) {
      sent.push(cmd);
      const r = responses.shift();
      if (r instanceof Error) throw r;
      return r as never;
    },
  };
  return { s, sent };
}

const toolReply = (input: unknown) => ({ output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 't', name: 'record_commitments', input } }] } } });

describe('BedrockStructuredLlm', () => {
  it('forces the tool for Anthropic models and returns its input', async () => {
    const { s, sent } = sender([toolReply({ commitments: [] })]);
    const llm = new BedrockStructuredLlm('us.anthropic.claude-haiku-4-5-20251001-v1:0', { client: s });
    expect(await llm.structured(req)).toEqual({ commitments: [] });
    const input = sent[0]!.input;
    expect(input.toolConfig?.toolChoice).toEqual({ tool: { name: 'record_commitments' } });
    expect(input.inferenceConfig?.temperature).toBe(0);
    expect(input.system).toEqual([{ text: 'sys' }]);
  });

  it('uses "any" tool choice for non-Anthropic models', async () => {
    const { s, sent } = sender([toolReply({ ok: true })]);
    await new BedrockStructuredLlm('us.amazon.nova-lite-v1:0', { client: s }).structured(req);
    expect(sent[0]!.input.toolConfig?.toolChoice).toEqual({ any: {} });
  });

  it('retries throttling, then succeeds', async () => {
    const throttle = Object.assign(new Error('slow down'), { name: 'ThrottlingException' });
    const { s, sent } = sender([throttle, toolReply({ commitments: [1] })]);
    const llm = new BedrockStructuredLlm('anthropic.x', { client: s, baseDelayMs: 1 });
    expect(await llm.structured(req)).toEqual({ commitments: [1] });
    expect(sent).toHaveLength(2);
  });

  it('does not retry access errors and reports a missing tool call', async () => {
    const denied = Object.assign(new Error('no access'), { name: 'AccessDeniedException' });
    const a = sender([denied]);
    await expect(new BedrockStructuredLlm('anthropic.x', { client: a.s, baseDelayMs: 1 }).structured(req)).rejects.toThrow('no access');
    expect(a.sent).toHaveLength(1);
    const b = sender([{ output: { message: { role: 'assistant', content: [{ text: 'I cannot' }] } } }]);
    await expect(new BedrockStructuredLlm('anthropic.x', { client: b.s }).structured(req)).rejects.toThrow(/did not call record_commitments; said: I cannot/);
  });
});
