import { BeeApiError } from '../bee/client.js';
import { LlmHttpError } from '../ai/http.js';

/** Turn common failures into one actionable line for the terminal. */
export function explainError(err: unknown): string {
  if (err instanceof BeeApiError) {
    if (err.status === 401 || err.status === 403) return 'Bee rejected the request: your login may have expired. Run `bee login`, then restart Nectar.';
    if (err.status === 404) return `Bee could not find ${err.path} (it may have been deleted).`;
    if (err.status === 429) return 'Bee is rate-limiting requests; Nectar will retry later.';
    if (err.status >= 500) return `Bee had a server error (${err.status}); Nectar will retry later.`;
    return err.message;
  }
  if (err instanceof LlmHttpError) {
    if (err.status === 401 || err.status === 403) return `${err.provider} rejected the API key. Check ANTHROPIC_API_KEY or NECTAR_LLM_API_KEY in .env.`;
    if (err.status === 404) return `${err.provider} does not know this model or endpoint. Check NECTAR_MODEL_ID and NECTAR_LLM_BASE_URL.`;
    if (err.status === 0) return `${err.message}. For a local model, is the server running (for example \`ollama serve\`)?`;
    if (err.status === 429 || err.status === 529) return `${err.provider} is rate-limiting requests; Nectar retried and will try again on the next window.`;
    return err.message;
  }
  const name = (err as { name?: string })?.name ?? '';
  const msg = err instanceof Error ? err.message : String(err);
  if (name === 'AccessDeniedException') {
    return `Bedrock denied access to the model. Submit the Anthropic use-case form in the Bedrock console, or set NECTAR_MODEL_ID=us.amazon.nova-lite-v1:0. (${msg})`;
  }
  if (name === 'ValidationException' && /model/i.test(msg)) return `Bedrock rejected the model ID. Check NECTAR_MODEL_ID and AWS_REGION. (${msg})`;
  if (name === 'CredentialsProviderError' || /Could not load credentials/i.test(msg)) {
    return 'No AWS credentials found. Run `aws configure` or set AWS_PROFILE.';
  }
  if (name === 'ThrottlingException') return 'Bedrock is throttling requests; Nectar retried and will try again on the next window.';
  if ((err as { code?: string })?.code === 'ENOENT') return 'Command not found. Is the Bee CLI installed? Run `npm i -g @beeai/cli`.';
  if (/ECONNREFUSED|fetch failed/i.test(msg)) return 'Could not reach the Bee proxy; Nectar will restart it.';
  return msg;
}
