import { describe, expect, it } from 'vitest';
import { overlap, tokens } from '../src/util/text.js';

describe('text matching', () => {
  it('drops stop words and plural s', () => {
    expect(tokens("I'll send Musa the price lists")).toEqual(['send', 'musa', 'price', 'list']);
  });
  it('stems common verb forms', () => {
    expect(tokens('updated updating updates update')).toEqual(['update', 'update', 'update', 'update']);
    expect(tokens('called emailed checked sending')).toEqual(['call', 'email', 'check', 'send']);
  });

  it('scores overlap against the smaller set', () => {
    expect(overlap('price list', 'Send Musa the price list')).toBe(1);
    expect(overlap('Send the price list', 'Call the landlord')).toBe(0);
    expect(overlap('', 'x')).toBe(0);
  });
});
