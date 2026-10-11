import { explainError } from './errors.js';

const ts = () => new Date().toISOString().slice(11, 19);
const debugOn = () => (process.env.NECTAR_LOG_LEVEL ?? '').toLowerCase() === 'debug';

export const log = {
  debug: (msg: string) => {
    if (debugOn()) console.log(`${ts()}  . ${msg}`);
  },
  info: (msg: string) => console.log(`${ts()}  ${msg}`),
  warn: (msg: string) => console.warn(`${ts()}  ! ${msg}`),
  error: (msg: string, err?: unknown) => {
    console.error(`${ts()}  x ${msg}${err !== undefined ? `: ${explainError(err)}` : ''}`);
    if (err instanceof Error && debugOn() && err.stack) console.error(err.stack);
  },
};
