import { describe, expect, it } from 'vitest';
import { DEFAULT_STREAM_TYPES, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ beeBin: 'bee', proxyUrl: 'http://127.0.0.1:8787', streamMode: 'cli', timezone: 'Africa/Monrovia' });
    expect(c.streamTypes).toEqual(DEFAULT_STREAM_TYPES);
  });

  it('reads Phase 3 settings', () => {
    expect(loadConfig({}).reviewTime).toBe('18:00');
    expect(loadConfig({ NECTAR_REVIEW_TIME: 'off' }).reviewTime).toBeNull();
    expect(loadConfig({ NECTAR_REVIEW_TIME: '7:30' }).reviewTime).toBe('07:30');
    expect(loadConfig({ NECTAR_ALARM_LEAD_MIN: '30' }).alarmLeadMs).toBe(1_800_000);
    expect(() => loadConfig({ NECTAR_REVIEW_TIME: '25:00' })).toThrow();
  });

  it('rejects bad values', () => {
    expect(() => loadConfig({ BEE_PROXY_PORT: 'abc' })).toThrow();
    expect(() => loadConfig({ NECTAR_STREAM_MODE: 'ws' })).toThrow();
  });
});
