import { describe, expect, it } from 'vitest';
import { LagMeter } from '../src/util/lag.js';

describe('LagMeter', () => {
  it('times from Enter to the first utterance after it', () => {
    const m = new LagMeter();
    expect(m.heard(1000)).toBeNull(); // before any Enter
    m.press(2000);
    expect(m.heard(6500)).toBe(4500);
    expect(m.heard(7000)).toBeNull(); // only the first utterance after each press
    m.press(10_000);
    m.heard(12_000);
    expect(m.summary()).toBe('lag 4.5 s, 2 s after Enter');
  });

  it('says so when nothing was measured', () => {
    expect(new LagMeter().summary()).toMatch(/not measured/);
  });
});
