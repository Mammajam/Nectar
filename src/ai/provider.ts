import type { Config } from '../config.js';
import { AnthropicStructuredLlm } from './anthropic.js';
import { BedrockStructuredLlm } from './bedrock.js';
import { OpenAiCompatibleStructuredLlm } from './openai-compatible.js';
import type { StructuredLlm } from './types.js';

/** Build the model client chosen by NECTAR_PROVIDER (default: Amazon Bedrock). */
export function createLlm(config: Config, modelId: string = config.modelId): StructuredLlm {
  switch (config.provider) {
    case 'anthropic':
      if (!config.llmApiKey) throw new Error('NECTAR_PROVIDER=anthropic needs ANTHROPIC_API_KEY (or NECTAR_LLM_API_KEY) in .env');
      return new AnthropicStructuredLlm(modelId, { apiKey: config.llmApiKey, baseUrl: config.llmBaseUrl ?? undefined });
    case 'openai':
      return new OpenAiCompatibleStructuredLlm(modelId, { apiKey: config.llmApiKey ?? undefined, baseUrl: config.llmBaseUrl ?? undefined });
    default:
      return new BedrockStructuredLlm(modelId, { region: config.awsRegion });
  }
}
