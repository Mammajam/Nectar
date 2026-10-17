import { postJson, type PostOptions } from './http.js';
import type { StructuredLlm, StructuredRequest } from './types.js';

/** Ollama's OpenAI-compatible endpoint. */
export const OPENAI_COMPATIBLE_DEFAULT_URL = 'http://localhost:11434/v1';
export const OPENAI_COMPATIBLE_DEFAULT_MODEL = 'llama3.1';

export interface OpenAiCompatibleOptions extends Partial<PostOptions> {
  apiKey?: string;
  baseUrl?: string;
}

/** Pull a JSON object out of plain model text (some local models answer in a code block instead of calling the tool). */
export function jsonFromText(text: string): unknown | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const candidate = (fenced ?? text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Chat Completions API with a forced function call. Works with any OpenAI-compatible
 * server: Ollama or LM Studio on this machine (no key, nothing leaves the laptop), or a hosted one.
 */
export class OpenAiCompatibleStructuredLlm implements StructuredLlm {
  constructor(
    readonly modelId: string = OPENAI_COMPATIBLE_DEFAULT_MODEL,
    private readonly opts: OpenAiCompatibleOptions = {},
  ) {}

  async structured(req: StructuredRequest): Promise<unknown> {
    const base = (this.opts.baseUrl ?? OPENAI_COMPATIBLE_DEFAULT_URL).replace(/\/$/, '');
    const reply = (await postJson(
      `${base}/chat/completions`,
      this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {},
      {
        model: this.modelId,
        temperature: 0,
        max_tokens: req.maxTokens ?? 1024,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        tools: [{ type: 'function', function: { name: req.tool.name, description: req.tool.description, parameters: req.tool.schema } }],
        tool_choice: { type: 'function', function: { name: req.tool.name } },
      },
      { provider: 'OpenAI-compatible server', fetchImpl: this.opts.fetchImpl, maxRetries: this.opts.maxRetries, baseDelayMs: this.opts.baseDelayMs },
    )) as { choices?: { message?: { content?: string | null; tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[] };

    const message = reply.choices?.[0]?.message;
    const call = message?.tool_calls?.find((c) => c.function?.name === req.tool.name) ?? message?.tool_calls?.[0];
    if (call?.function?.arguments) {
      try {
        return JSON.parse(call.function.arguments);
      } catch {
        throw new Error(`model returned invalid JSON arguments for ${req.tool.name}`);
      }
    }
    const text = message?.content ?? '';
    const parsed = jsonFromText(text);
    if (parsed !== null) return parsed;
    throw new Error(`model did not call ${req.tool.name}${text ? `; said: ${text.slice(0, 200)}` : ''}`);
  }
}
