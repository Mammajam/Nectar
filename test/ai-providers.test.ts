import { describe, expect, it, vi } from 'vitest';
import { AnthropicStructuredLlm } from '../src/ai/anthropic.js';
import { LlmHttpError } from '../src/ai/http.js';
import { OpenAiCompatibleStructuredLlm, jsonFromText } from '../src/ai/openai-compatible.js';
import { createLlm } from '../src/ai/provider.js';
import { BedrockStructuredLlm } from '../src/ai/bedrock.js';
import { loadConfig } from '../src/config.js';
import { explainError } from '../src/util/errors.js';

const req = {
  system: 'sys',
  user: 'hello',
  tool: { name: 'record_commitments', description: 'd', schema: { type: 'object', properties: {} } },
  maxTokens: 200,
};
const reply = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const sequence = (...responses: (Response | Error)[]) => {
  const f = vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) => {
    const next = responses.shift()!;
    if (next instanceof Error) throw next;
    return next;
  });
  return f;
};
const asFetch = (f: unknown) => f as unknown as typeof fetch;
const bodyOf = (f: ReturnType<typeof sequence>, call = 0) => JSON.parse(String(f.mock.calls[call]![1]!.body));

describe('AnthropicStructuredLlm', () => {
  it('sends a forced tool call and returns the tool input', async () => {
    const f = sequence(reply(200, { content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name: 'record_commitments', input: { commitments: [] } }] }));
    const llm = new AnthropicStructuredLlm('claude-haiku-4-5', { apiKey: 'k', fetchImpl: asFetch(f) });
    expect(await llm.structured(req)).toEqual({ commitments: [] });
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    expect((init!.headers as Record<string, string>)['x-api-key']).toBe('k');
    expect((init!.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
    expect(bodyOf(f)).toMatchObject({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      temperature: 0,
      system: 'sys',
      messages: [{ role: 'user', content: 'hello' }],
      tool_choice: { type: 'tool', name: 'record_commitments' },
      tools: [{ name: 'record_commitments', input_schema: { type: 'object' } }],
    });
  });

  it('drops temperature once for a model that rejects it, then keeps leaving it out', async () => {
    const ok = () => reply(200, { content: [{ type: 'tool_use', name: 'record_commitments', input: { ok: true } }] });
    const f = sequence(reply(400, '{"error":{"message":"`temperature` is deprecated for this model."}}'), ok(), ok());
    const llm = new AnthropicStructuredLlm('claude-haiku-5-5', { apiKey: 'k', fetchImpl: asFetch(f), baseDelayMs: 1 });
    expect(await llm.structured(req)).toEqual({ ok: true });
    expect(bodyOf(f, 0)).toHaveProperty('temperature', 0);
    expect(bodyOf(f, 1)).not.toHaveProperty('temperature');
    await llm.structured(req);
    expect(f).toHaveBeenCalledTimes(3);
    expect(bodyOf(f, 2)).not.toHaveProperty('temperature');
  });

  it('does not swallow other 400 errors', async () => {
    const f = sequence(reply(400, '{"error":{"message":"max_tokens too large"}}'));
    const llm = new AnthropicStructuredLlm('m', { apiKey: 'k', fetchImpl: asFetch(f), baseDelayMs: 1 });
    await expect(llm.structured(req)).rejects.toThrow(/400/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('retries throttling and overload, then succeeds', async () => {
    const f = sequence(reply(429, 'slow down'), reply(529, 'overloaded'), reply(200, { content: [{ type: 'tool_use', name: 'record_commitments', input: { ok: true } }] }));
    const llm = new AnthropicStructuredLlm('m', { apiKey: 'k', fetchImpl: asFetch(f), baseDelayMs: 1 });
    expect(await llm.structured(req)).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('does not retry a rejected key, and never puts the key in the error', async () => {
    const f = sequence(reply(401, '{"error":"invalid x-api-key"}'));
    const llm = new AnthropicStructuredLlm('m', { apiKey: 'sk-secret', fetchImpl: asFetch(f), baseDelayMs: 1 });
    const err = await llm.structured(req).catch((e) => e);
    expect(err).toBeInstanceOf(LlmHttpError);
    expect(err.status).toBe(401);
    expect(String(err.message)).not.toContain('sk-secret');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retries and reports when the model skipped the tool', async () => {
    const stuck = sequence(reply(429, 'a'), reply(429, 'b'));
    await expect(new AnthropicStructuredLlm('m', { apiKey: 'k', fetchImpl: asFetch(stuck), maxRetries: 1, baseDelayMs: 1 }).structured(req)).rejects.toMatchObject({ status: 429 });
    const noTool = sequence(reply(200, { content: [{ type: 'text', text: 'I cannot' }] }));
    await expect(new AnthropicStructuredLlm('m', { apiKey: 'k', fetchImpl: asFetch(noTool) }).structured(req)).rejects.toThrow(/did not call record_commitments; said: I cannot/);
  });

  it('retries a connection failure and reports it as status 0', async () => {
    const f = sequence(new Error('ECONNRESET'), new Error('ECONNRESET'));
    const err = await new AnthropicStructuredLlm('m', { apiKey: 'k', fetchImpl: asFetch(f), maxRetries: 1, baseDelayMs: 1 }).structured(req).catch((e) => e);
    expect(err).toMatchObject({ status: 0 });
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('OpenAiCompatibleStructuredLlm', () => {
  const call = (args: string) => ({ choices: [{ message: { content: null, tool_calls: [{ function: { name: 'record_commitments', arguments: args } }] } }] });

  it('sends a forced function call to the local server and parses the arguments', async () => {
    const f = sequence(reply(200, call('{"commitments":[{"what":"x"}]}')));
    const llm = new OpenAiCompatibleStructuredLlm('llama3.1', { fetchImpl: asFetch(f) });
    expect(await llm.structured(req)).toEqual({ commitments: [{ what: 'x' }] });
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe('http://localhost:11434/v1/chat/completions');
    expect((init!.headers as Record<string, string>).authorization).toBeUndefined();
    expect(bodyOf(f)).toMatchObject({
      model: 'llama3.1',
      temperature: 0,
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hello' }],
      tool_choice: { type: 'function', function: { name: 'record_commitments' } },
      tools: [{ type: 'function', function: { name: 'record_commitments' } }],
    });
  });

  it('sends the bearer token when a key is set, and uses a custom base URL', async () => {
    const f = sequence(reply(200, call('{}')));
    await new OpenAiCompatibleStructuredLlm('m', { apiKey: 'tok', baseUrl: 'https://example.test/v1/', fetchImpl: asFetch(f) }).structured(req);
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe('https://example.test/v1/chat/completions');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('accepts JSON in plain text when a local model skips the tool call', async () => {
    const f = sequence(reply(200, { choices: [{ message: { content: 'Here you go:\n```json\n{"commitments":[]}\n```' } }] }));
    expect(await new OpenAiCompatibleStructuredLlm('m', { fetchImpl: asFetch(f) }).structured(req)).toEqual({ commitments: [] });
  });

  it('fails clearly on invalid arguments or no answer, and retries a busy server', async () => {
    const bad = sequence(reply(200, call('{not json')));
    await expect(new OpenAiCompatibleStructuredLlm('m', { fetchImpl: asFetch(bad) }).structured(req)).rejects.toThrow(/invalid JSON arguments/);
    const none = sequence(reply(200, { choices: [{ message: { content: 'sorry' } }] }));
    await expect(new OpenAiCompatibleStructuredLlm('m', { fetchImpl: asFetch(none) }).structured(req)).rejects.toThrow(/did not call record_commitments; said: sorry/);
    const busy = sequence(reply(503, 'loading model'), reply(200, call('{"ok":1}')));
    expect(await new OpenAiCompatibleStructuredLlm('m', { fetchImpl: asFetch(busy), baseDelayMs: 1 }).structured(req)).toEqual({ ok: 1 });
  });

  it('jsonFromText finds objects in fenced and bare text, and returns null otherwise', () => {
    expect(jsonFromText('```\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(jsonFromText('result: {"a":1} done')).toEqual({ a: 1 });
    expect(jsonFromText('nothing here')).toBeNull();
    expect(jsonFromText('{broken')).toBeNull();
  });
});

describe('provider selection and config', () => {
  it('defaults to Bedrock with its default model', () => {
    const c = loadConfig({});
    expect(c.provider).toBe('bedrock');
    expect(c.modelId).toBe('us.anthropic.claude-haiku-4-5-20251001-v1:0');
    expect(createLlm(c)).toBeInstanceOf(BedrockStructuredLlm);
  });

  it('picks provider-specific default models and keys', () => {
    const a = loadConfig({ NECTAR_PROVIDER: 'Anthropic', ANTHROPIC_API_KEY: 'sk-a' });
    expect(a).toMatchObject({ provider: 'anthropic', modelId: 'claude-haiku-4-5', llmApiKey: 'sk-a' });
    expect(createLlm(a)).toBeInstanceOf(AnthropicStructuredLlm);
    const o = loadConfig({ NECTAR_PROVIDER: 'openai', NECTAR_LLM_BASE_URL: 'http://127.0.0.1:1234/v1' });
    expect(o).toMatchObject({ provider: 'openai', modelId: 'llama3.1', llmApiKey: null, llmBaseUrl: 'http://127.0.0.1:1234/v1' });
    expect(createLlm(o)).toBeInstanceOf(OpenAiCompatibleStructuredLlm);
    expect(loadConfig({ NECTAR_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-o' }).llmApiKey).toBe('sk-o');
    expect(loadConfig({ NECTAR_PROVIDER: 'anthropic', NECTAR_MODEL_ID: 'claude-sonnet-4-5' }).modelId).toBe('claude-sonnet-4-5');
  });

  it('rejects an unknown provider and an anthropic provider without a key', () => {
    expect(() => loadConfig({ NECTAR_PROVIDER: 'gemini' })).toThrow(/NECTAR_PROVIDER/);
    expect(() => createLlm(loadConfig({ NECTAR_PROVIDER: 'anthropic' }))).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('explains provider failures in one line', () => {
    expect(explainError(new LlmHttpError(401, 'Anthropic', 'x'))).toMatch(/rejected the API key/);
    expect(explainError(new LlmHttpError(404, 'Anthropic', 'x'))).toMatch(/NECTAR_MODEL_ID/);
    expect(explainError(new LlmHttpError(0, 'OpenAI-compatible server', 'could not reach'))).toMatch(/ollama serve/);
    expect(explainError(new LlmHttpError(429, 'Anthropic', 'x'))).toMatch(/rate-limiting/);
    expect(explainError(new LlmHttpError(500, 'Anthropic', 'boom'))).toBe('boom');
  });
});
