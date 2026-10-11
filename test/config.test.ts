import { describe, expect, it } from 'vitest';
import { DEFAULT_STREAM_TYPES, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ beeBin: 'bee', proxyUrl: 'http://127.0.0.1:8787', streamMode: 'cli', timezone: 'Africa/Monrovia' });
    expect(c.streamTypes).toEqual(DEFAULT_STREAM_TYPES);
  });

  it('rejects bad values', () => {
    expect(() => loadConfig({ BEE_PROXY_PORT: 'abc' })).toThrow();
    expect(() => loadConfig({ NECTAR_STREAM_MODE: 'ws' })).toThrow();
  });
});
