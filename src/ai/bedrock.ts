import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandOutput,
  type ToolChoice,
} from '@aws-sdk/client-bedrock-runtime';
import { backoffDelay, sleep } from '../util/backoff.js';
import type { StructuredLlm, StructuredRequest } from './types.js';

import { DEFAULT_MODEL_ID } from '../config.js';

export interface ConverseSender {
  send(command: ConverseCommand): Promise<ConverseCommandOutput>;
}

const RETRYABLE = new Set(['ThrottlingException', 'ServiceUnavailableException', 'ModelNotReadyException', 'InternalServerException']);

/**
 * Amazon Bedrock Converse API with forced tool use, so the model must return
 * JSON that matches the tool's input schema.
 */
export class BedrockStructuredLlm implements StructuredLlm {
  private readonly client: ConverseSender;

  constructor(
    readonly modelId: string = DEFAULT_MODEL_ID,
    opts: { region?: string; client?: ConverseSender; maxRetries?: number; baseDelayMs?: number } = {},
  ) {
    this.client = opts.client ?? new BedrockRuntimeClient({ region: opts.region ?? process.env.AWS_REGION ?? 'us-east-1' });
    this.maxRetries = opts.maxRetries ?? 3;
    this.baseDelayMs = opts.baseDelayMs ?? 1000;
  }

  private readonly maxRetries: number;
  private readonly baseDelayMs: number;

  /** Anthropic models accept a specific forced tool; others get "any tool". */
  private toolChoice(name: string): ToolChoice {
    return this.modelId.includes('anthropic') ? { tool: { name } } : { any: {} };
  }

  async structured(req: StructuredRequest): Promise<unknown> {
    const command = new ConverseCommand({
      modelId: this.modelId,
      system: [{ text: req.system }],
      messages: [{ role: 'user', content: [{ text: req.user }] }],
      inferenceConfig: { maxTokens: req.maxTokens ?? 1024, temperature: 0 },
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: req.tool.name,
              description: req.tool.description,
              inputSchema: { json: req.tool.schema as never },
            },
          },
        ],
        toolChoice: this.toolChoice(req.tool.name),
      },
    });

    let attempt = 0;
    for (;;) {
      try {
        const out = await this.client.send(command);
        const blocks = out.output?.message?.content ?? [];
        const toolUse = blocks.find((b) => b.toolUse?.name === req.tool.name)?.toolUse;
        if (!toolUse) {
          const text = blocks.map((b) => b.text ?? '').join(' ').trim();
          throw new Error(`model did not call ${req.tool.name}${text ? `; said: ${text.slice(0, 200)}` : ''}`);
        }
        return toolUse.input;
      } catch (err) {
        const name = (err as { name?: string }).name ?? '';
        if (!RETRYABLE.has(name) || attempt >= this.maxRetries) throw err;
        await sleep(backoffDelay(attempt++, this.baseDelayMs));
      }
    }
  }
}
