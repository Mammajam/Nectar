export type StreamMode = 'cli' | 'sse';
export type Provider = 'bedrock' | 'anthropic' | 'openai';

export interface Config {
  beeBin: string;
  proxyPort: number;
  proxyUrl: string;
  dbPath: string;
  timezone: string;
  streamMode: StreamMode;
  streamTypes: string[];
  /** Which model API extracts commitments: Amazon Bedrock (default), Anthropic directly, or an OpenAI-compatible server (Ollama etc.). */
  provider: Provider;
  awsRegion: string;
  modelId: string;
  /** Base URL for the anthropic and openai providers; null = the provider's default. */
  llmBaseUrl: string | null;
  /** API key for the anthropic and openai providers. Never logged. */
  llmApiKey: string | null;
  /** Commitments below this are discarded. */
  minConfidence: number;
  /** At or above this a commitment is "open"; below it, "suggested". */
  openThreshold: number;
  /** Silence before a conversation window is analyzed. */
  windowPauseMs: number;
  /** Set NECTAR_EXTRACTION=off to run Phase 1 only (no model calls). */
  extractionEnabled: boolean;
  /** Phase 3: create Bee to-dos with alarms for open commitments. */
  createTodos: boolean;
  alarmLeadMs: number;
  workdayStartHour: number;
  /** After this hour, untimed promises roll to the next morning. */
  sameDayCutoffHour: number;
  /** "HH:MM" local time for the evening review, or null when off. */
  reviewTime: string | null;
  /** F3: pre-meeting recaps from today's calendar. */
  recapEnabled: boolean;
  recapLeadMs: number;
  /** Re-run catch-up this often to fill gaps in the at-most-once stream. */
  catchUpIntervalMs: number;
}

export const DEFAULT_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

/** Model used when NECTAR_MODEL_ID is not set, per provider (`openai` defaults to a local Ollama model). */
export const DEFAULT_MODELS: Record<Provider, string> = {
  bedrock: DEFAULT_MODEL_ID,
  anthropic: 'claude-haiku-4-5',
  openai: 'llama3.1',
};

function num(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${key} must be a number between ${min} and ${max}, got "${raw}"`);
  return n;
}

export const DEFAULT_STREAM_TYPES = [
  'new-utterance',
  'new-conversation',
  'update-conversation',
  'journal-text',
  'todo-created',
  'todo-updated',
];

function reviewTime(raw: string | undefined): string | null {
  if (raw === undefined || raw === '') return '18:00';
  if (raw.toLowerCase() === 'off') return null;
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`NECTAR_REVIEW_TIME must be HH:MM or "off", got "${raw}"`);
  return `${m[1]!.padStart(2, '0')}:${m[2]}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const proxyPort = Number(env.BEE_PROXY_PORT ?? 8787);
  if (!Number.isInteger(proxyPort) || proxyPort <= 0) {
    throw new Error(`BEE_PROXY_PORT must be a positive integer, got "${env.BEE_PROXY_PORT}"`);
  }
  const mode = (env.NECTAR_STREAM_MODE ?? 'cli').toLowerCase();
  if (mode !== 'cli' && mode !== 'sse') {
    throw new Error(`NECTAR_STREAM_MODE must be "cli" or "sse", got "${mode}"`);
  }
  const provider = (env.NECTAR_PROVIDER ?? 'bedrock').toLowerCase();
  if (provider !== 'bedrock' && provider !== 'anthropic' && provider !== 'openai') {
    throw new Error(`NECTAR_PROVIDER must be "bedrock", "anthropic" or "openai", got "${provider}"`);
  }
  const types = (env.NECTAR_STREAM_TYPES ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  return {
    beeBin: env.BEE_BIN ?? 'bee',
    proxyPort,
    proxyUrl: `http://127.0.0.1:${proxyPort}`,
    dbPath: env.NECTAR_DB_PATH ?? './data/nectar.db',
    timezone: env.NECTAR_TIMEZONE ?? 'Africa/Monrovia',
    streamMode: mode,
    streamTypes: types.length > 0 ? types : DEFAULT_STREAM_TYPES,
    provider,
    awsRegion: env.AWS_REGION || 'us-east-1',
    modelId: env.NECTAR_MODEL_ID || DEFAULT_MODELS[provider],
    llmBaseUrl: env.NECTAR_LLM_BASE_URL || null,
    llmApiKey: (provider === 'anthropic' ? env.ANTHROPIC_API_KEY || env.NECTAR_LLM_API_KEY : env.NECTAR_LLM_API_KEY || env.OPENAI_API_KEY) || null,
    minConfidence: num(env, 'NECTAR_MIN_CONFIDENCE', 0.4, 0, 1),
    openThreshold: num(env, 'NECTAR_OPEN_THRESHOLD', 0.7, 0, 1),
    windowPauseMs: num(env, 'NECTAR_WINDOW_PAUSE_MS', 20_000, 1000, 600_000),
    extractionEnabled: (env.NECTAR_EXTRACTION ?? 'on').toLowerCase() !== 'off',
    createTodos: (env.NECTAR_CREATE_TODOS ?? 'on').toLowerCase() !== 'off',
    alarmLeadMs: num(env, 'NECTAR_ALARM_LEAD_MIN', 10, 0, 240) * 60_000,
    workdayStartHour: num(env, 'NECTAR_WORKDAY_START', 9, 0, 23),
    sameDayCutoffHour: num(env, 'NECTAR_SAME_DAY_CUTOFF', 16, 0, 23),
    reviewTime: reviewTime(env.NECTAR_REVIEW_TIME),
    recapEnabled: (env.NECTAR_RECAP ?? 'on').toLowerCase() !== 'off',
    recapLeadMs: num(env, 'NECTAR_RECAP_LEAD_MIN', 10, 1, 120) * 60_000,
    catchUpIntervalMs: num(env, 'NECTAR_CATCHUP_MIN', 5, 1, 1440) * 60_000,
  };
}
