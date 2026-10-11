export type StreamMode = 'cli' | 'sse';

export interface Config {
  beeBin: string;
  proxyPort: number;
  proxyUrl: string;
  dbPath: string;
  timezone: string;
  streamMode: StreamMode;
  streamTypes: string[];
}

export const DEFAULT_STREAM_TYPES = [
  'new-utterance',
  'new-conversation',
  'update-conversation',
  'journal-text',
  'todo-created',
  'todo-updated',
];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const proxyPort = Number(env.BEE_PROXY_PORT ?? 8787);
  if (!Number.isInteger(proxyPort) || proxyPort <= 0) {
    throw new Error(`BEE_PROXY_PORT must be a positive integer, got "${env.BEE_PROXY_PORT}"`);
  }
  const mode = (env.NECTAR_STREAM_MODE ?? 'cli').toLowerCase();
  if (mode !== 'cli' && mode !== 'sse') {
    throw new Error(`NECTAR_STREAM_MODE must be "cli" or "sse", got "${mode}"`);
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
  };
}
