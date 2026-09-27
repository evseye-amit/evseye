import { describe, expect, it } from 'vitest';
import { money } from './wallet.service.js';

describe('wallet money precision', () => {
  it('accepts exact paise values without floating point conversion', () => {
    expect(money('0.01').plus(money('0.02')).toFixed(2)).toBe('0.03');
    expect(money('1000.00').toFixed(2)).toBe('1000.00');
  });
  it.each(['0.00', '-1.00', '1', '1.001', 'NaN', '1e3'])('rejects invalid amount %s', value => {
    expect(() => money(value)).toThrow();
  });
});
