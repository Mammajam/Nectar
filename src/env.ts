import { existsSync } from 'node:fs';

/** Load ./.env if present (Node's built-in loader; no dependency needed). */
export function loadDotEnv(path = '.env'): void {
  if (existsSync(path)) process.loadEnvFile(path);
}
