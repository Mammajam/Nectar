import { postJson, type PostOptions } from './http.js';
import type { StructuredLlm, StructuredRequest } from './types.js';

export const ANTHROPIC_DEFAULT_MODEL = 'claude-haiku-4-5';

export interface AnthropicOptions extends Partial<PostOptions> {
  apiKey: string;
  baseUrl?: string;
}

/**
 * Anthropic Messages API with forced tool use, so the model must return JSON that
 * matches the tool's input schema. Same contract as the Bedrock client.
 */
export class AnthropicStructuredLlm implements StructuredLlm {
  constructor(
    readonly modelId: string = ANTHROPIC_DEFAULT_MODEL,
    private readonly opts: AnthropicOptions,
  ) {}

  async structured(req: StructuredRequest): Promise<unknown> {
    const base = (this.opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
    const reply = (await postJson(
      `${base}/v1/messages`,
      { 'x-api-key': this.opts.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: this.modelId,
        max_tokens: req.maxTokens ?? 1024,
        temperature: 0,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        tools: [{ name: req.tool.name, description: req.tool.description, input_schema: req.tool.schema }],
        tool_choice: { type: 'tool', name: req.tool.name },
      },
      { provider: 'Anthropic', fetchImpl: this.opts.fetchImpl, maxRetries: this.opts.maxRetries, baseDelayMs: this.opts.baseDelayMs },
    )) as { content?: { type?: string; name?: string; input?: unknown; text?: string }[] };

    const blocks = Array.isArray(reply.content) ? reply.content : [];
    const use = blocks.find((b) => b.type === 'tool_use' && b.name === req.tool.name);
    if (!use) {
      const text = blocks.map((b) => b.text ?? '').join(' ').trim();
      throw new Error(`model did not call ${req.tool.name}${text ? `; said: ${text.slice(0, 200)}` : ''}`);
    }
    return use.input;
  }
}
