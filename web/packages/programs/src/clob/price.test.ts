import { describe, expect, it } from 'vitest';
import {
  clobMarketPriceNumber,
  formatClobMarketPrice,
  parseClobMarketPrice,
} from './price';

describe('CLOB market price units', () => {
  const creditsPerWholeAsset = { baseDecimals: 0, quoteDecimals: 6 };

  it('formats raw quote units as whole-token market prices', () => {
    expect(formatClobMarketPrice(1_922_000_000n, creditsPerWholeAsset)).toBe('1922');
    expect(formatClobMarketPrice(1_922_500_000n, creditsPerWholeAsset)).toBe('1922.5');
    expect(clobMarketPriceNumber(1_922_000_000n, creditsPerWholeAsset)).toBe(1922);
  });

  it('parses displayed market prices into raw quote-per-base units', () => {
    expect(parseClobMarketPrice('1922', creditsPerWholeAsset)).toBe(1_922_000_000n);
    expect(parseClobMarketPrice('1922.5', creditsPerWholeAsset)).toBe(1_922_500_000n);
  });

  it('accounts for base decimals as well as quote decimals', () => {
    const equalDecimals = { baseDecimals: 6, quoteDecimals: 6 };
    expect(formatClobMarketPrice(1922n, equalDecimals)).toBe('1922');
    expect(parseClobMarketPrice('1922', equalDecimals)).toBe(1922n);
  });

  it('rejects prices that cannot be represented exactly', () => {
    expect(() => parseClobMarketPrice('1.0000001', creditsPerWholeAsset))
      .toThrow('at most 6 decimal places');
  });
});
