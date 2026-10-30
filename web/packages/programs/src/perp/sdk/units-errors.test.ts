import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TransactionVmError } from '@thru/sdk/proto';
import * as perp from '../index';
import {
  PERP_ERROR_CODES,
  TransactionFailedError,
  TransactionTimeoutError,
  perpErrorKind,
  perpErrorName,
  perpErrorText,
  perpVmErrorName,
  signedUserErrorCode,
} from './errors';
import { toJsonSafe } from './json';
import {
  formatPerpPrice,
  formatPerpSize,
  parsePerpPrice,
  parsePerpSize,
  perpLotsToSize,
  perpPriceToTicks,
  perpRoundPrice,
  perpSizeToLots,
  perpTicksToPrice,
} from './units';

const REPO = fileURLToPath(new URL('../../../../../../', import.meta.url));

/** NAME -> value of every TN_PERP_ERR_* in tn_perp_program/errors.h, through the CLOB header it aliases. */
function headerErrors(): Map<string, number> {
  const perpHeader = readFileSync(`${REPO}thru-perps/tn_perp_program/errors.h`, 'utf8');
  const clobHeader = readFileSync(`${REPO}programs/c/examples/tn_clob_program/errors.h`, 'utf8');
  const defines = new Map<string, string>();
  for (const text of [clobHeader, perpHeader]) {
    for (const match of text.matchAll(/^#define\s+(TN_(?:CLOB|PERP)_ERR_\w+)\s+(.+?)\s*(?:\/\*.*)?$/gm)) defines.set(match[1]!, match[2]!.trim());
  }
  const value = (name: string): number => {
    const raw = defines.get(name)!;
    if (defines.has(raw)) return value(raw);
    return Number(raw.replace(/[()UL\s]/g, ''));
  };
  const out = new Map<string, number>();
  for (const name of defines.keys()) if (name.startsWith('TN_PERP_ERR_')) out.set(name.slice('TN_PERP_ERR_'.length), value(name));
  return out;
}

describe('program errors', () => {
  it('names exactly the codes of tn_perp_program/errors.h', () => {
    expect(new Map(Object.entries(PERP_ERROR_CODES))).toEqual(headerErrors());
  });

  it('agrees with the SDK PERP_ERR_* constants', () => {
    for (const [name, code] of Object.entries(perp).filter(([name]) => name.startsWith('PERP_ERR_'))) {
      expect(PERP_ERROR_CODES[name.slice('PERP_ERR_'.length) as keyof typeof PERP_ERROR_CODES]).toBe(Number(code));
    }
  });

  it('decodes u64 codes and VM errors into names, kinds and sentences', () => {
    expect(signedUserErrorCode(BigInt.asUintN(64, -213n))).toBe(-213n);
    expect(perpErrorName(-224n)).toBe('MARGIN_VAULT_MISMATCH');
    expect(perpErrorText(-403)).toContain('insufficient collateral');
    expect(perpVmErrorName(TransactionVmError.TRANSACTION_VM_ERROR_SU_EXHAUSTED)).toBe('SU_EXHAUSTED');
    expect(perpErrorKind(TransactionVmError.TRANSACTION_VM_ERROR_NONCE_TOO_HIGH, 0n)).toBe('nonce');
    expect(perpErrorKind(-1, -220n)).toBe('margin-account');
    expect(perpErrorKind(-1, -9999n)).toBe('unknown');
    const error = new TransactionFailedError('withdraw', 'tsSIG', -1, -224n);
    expect(error.message).toBe("withdraw failed on-chain: the market's quote vault is not the margin account's vault");
    expect(error.toJSON()).toEqual({
      name: 'TransactionFailedError', message: error.message, label: 'withdraw', signature: 'tsSIG', kind: 'margin-account',
      code: 'MARGIN_VAULT_MISMATCH', userErrorCode: '-224', vmError: -1, vmErrorName: perpVmErrorName(-1), retryable: false,
    });
    const su = new TransactionFailedError('order', 'tsSIG', TransactionVmError.TRANSACTION_VM_ERROR_SU_EXHAUSTED, 0n);
    expect(su.message).toContain('SU_EXHAUSTED');
    expect(su.retryable).toBe(true);
    expect(new TransactionTimeoutError('order', 'tsSIGNATURE').toJSON()).toMatchObject({ kind: 'timeout', retryable: false });
  });
});

describe('units', () => {
  const market = { tickSize: 1_000n, lotSize: 10n, baseDecimals: 3, quoteDecimals: 6 };

  it('converts prices to ticks and sizes to lots, exactly or rounded', () => {
    expect(perpPriceToTicks(84_000_000n, 1_000n)).toBe(84_000n);
    expect(perpTicksToPrice(84_000n, 1_000n)).toBe(84_000_000n);
    expect(() => perpPriceToTicks(84_000_500n, 1_000n)).toThrow('not a multiple of 1000');
    expect(perpPriceToTicks(84_000_500n, 1_000n, 'nearest')).toBe(84_001n);
    expect(perpPriceToTicks(84_000_499n, 1_000n, 'nearest')).toBe(84_000n);
    expect(perpPriceToTicks(84_000_001n, 1_000n, 'up')).toBe(84_001n);
    expect(perpRoundPrice(84_000_999n, 1_000n, 'down')).toBe(84_000_000n);
    expect(perpSizeToLots(250n, 10n)).toBe(25n);
    expect(perpLotsToSize(25n, 10n)).toBe(250n);
    expect(() => perpSizeToLots(-10n, 10n)).toThrow('must not be negative');
  });

  it('parses and formats human prices and sizes', () => {
    /* quote 6 decimals, base 3: 84250.5 quote per base unit = 84,250,500 quote atoms per base atom / 10^3. */
    expect(parsePerpPrice('84250', market)).toBe(84_250_000n);
    expect(parsePerpPrice('84,250.5', market, 'down')).toBe(84_250_000n);
    expect(() => parsePerpPrice('84250.5', market)).toThrow('not a multiple');
    expect(parsePerpSize('0.25', market)).toBe(250n);
    expect(() => parsePerpSize('0.255', market)).toThrow('not a multiple of 10');
    expect(parsePerpSize('0.255', market, 'down')).toBe(250n);
    expect(formatPerpPrice(84_250_000n, market)).toBe('84,250');
    expect(formatPerpSize(250n, market)).toBe('0.25');
  });

  it('rounds the exact human price onto the tick grid, whichever decimals are larger', () => {
    const cases: Array<[label: string, m: { baseDecimals: number; quoteDecimals: number; tickSize: bigint }, human: string, down: bigint, nearest: bigint, up: bigint]> = [
      /* base > quote: 1 quote atom per base atom is 100 human units. */
      ['8/6 tick 1, 1.5 atoms', { baseDecimals: 8, quoteDecimals: 6, tickSize: 1n }, '150', 1n, 2n, 2n],
      ['8/6 tick 1, 1.49 atoms', { baseDecimals: 8, quoteDecimals: 6, tickSize: 1n }, '149', 1n, 1n, 2n],
      ['8/6 tick 1, 1.01 atoms', { baseDecimals: 8, quoteDecimals: 6, tickSize: 1n }, '101', 1n, 1n, 2n],
      ['8/6 tick 1, 0.5 atoms', { baseDecimals: 8, quoteDecimals: 6, tickSize: 1n }, '50', 0n, 1n, 1n],
      ['8/6 tick 1, below an atom', { baseDecimals: 8, quoteDecimals: 6, tickSize: 1n }, '0.5', 0n, 0n, 1n],
      ['8/6 tick 5, 7.5 atoms', { baseDecimals: 8, quoteDecimals: 6, tickSize: 5n }, '750', 5n, 10n, 10n],
      ['8/6 tick 5, 7.49 atoms', { baseDecimals: 8, quoteDecimals: 6, tickSize: 5n }, '749', 5n, 5n, 10n],
      ['9/2 tick 3, 4.5 atoms', { baseDecimals: 9, quoteDecimals: 2, tickSize: 3n }, '45000000', 3n, 6n, 6n],
      /* base < quote: digits past one quote atom per base atom still count. */
      ['3/6 tick 1000, sub-atom', { baseDecimals: 3, quoteDecimals: 6, tickSize: 1000n }, '84250.0005', 84_250_000n, 84_250_000n, 84_251_000n],
      ['3/6 tick 1000, half a tick', { baseDecimals: 3, quoteDecimals: 6, tickSize: 1000n }, '84250.5', 84_250_000n, 84_251_000n, 84_251_000n],
      ['3/6 tick 1000, under half', { baseDecimals: 3, quoteDecimals: 6, tickSize: 1000n }, '84250.4999', 84_250_000n, 84_250_000n, 84_251_000n],
      ['0/6 tick 1, sub-atom', { baseDecimals: 0, quoteDecimals: 6, tickSize: 1n }, '1.0000005', 1_000_000n, 1_000_001n, 1_000_001n],
      /* equal decimals: atoms are human units. */
      ['6/6 tick 10, 12.5', { baseDecimals: 6, quoteDecimals: 6, tickSize: 10n }, '12.5', 10n, 10n, 20n],
      ['6/6 tick 10, 15', { baseDecimals: 6, quoteDecimals: 6, tickSize: 10n }, '15', 10n, 20n, 20n],
      ['6/6 tick 10, on the grid', { baseDecimals: 6, quoteDecimals: 6, tickSize: 10n }, '20', 20n, 20n, 20n],
    ];
    for (const [label, m, human, down, nearest, up] of cases) {
      const unit = { ...m, lotSize: 1n };
      expect([parsePerpPrice(human, unit, 'down'), parsePerpPrice(human, unit, 'nearest'), parsePerpPrice(human, unit, 'up')], label).toEqual([down, nearest, up]);
      if (down === up) expect(parsePerpPrice(human, unit), label).toBe(down);
      else expect(() => parsePerpPrice(human, unit), label).toThrow();
    }
  });

  it('rounds the exact human size onto the lot grid', () => {
    const cases: Array<[label: string, m: { baseDecimals: number; lotSize: bigint }, human: string, down: bigint, nearest: bigint, up: bigint]> = [
      ['3 lot 10, past the base decimals', { baseDecimals: 3, lotSize: 10n }, '0.2555', 250n, 260n, 260n],
      ['3 lot 10, under half a lot', { baseDecimals: 3, lotSize: 10n }, '0.2549', 250n, 250n, 260n],
      ['3 lot 10, half an atom', { baseDecimals: 3, lotSize: 10n }, '0.0005', 0n, 0n, 10n],
      ['8 lot 1, sub-atom', { baseDecimals: 8, lotSize: 1n }, '0.000000015', 1n, 2n, 2n],
      ['0 lot 3, 4.5', { baseDecimals: 0, lotSize: 3n }, '4.5', 3n, 6n, 6n],
      ['6 lot 1000, on the grid', { baseDecimals: 6, lotSize: 1000n }, '0.002', 2_000n, 2_000n, 2_000n],
    ];
    for (const [label, m, human, down, nearest, up] of cases) {
      const unit = { ...m, quoteDecimals: 6, tickSize: 1n };
      expect([parsePerpSize(human, unit, 'down'), parsePerpSize(human, unit, 'nearest'), parsePerpSize(human, unit, 'up')], label).toEqual([down, nearest, up]);
      if (down === up) expect(parsePerpSize(human, unit), label).toBe(down);
      else expect(() => parsePerpSize(human, unit), label).toThrow();
    }
  });

  it('brackets the exact value between down and up across decimal combinations', () => {
    /* Every rounding is within one step of the exact ratio human × 10^shift / step. */
    for (const baseDecimals of [0, 3, 6, 8, 9]) {
      for (const quoteDecimals of [0, 2, 6, 9]) {
        for (const tickSize of [1n, 3n, 1000n]) {
          for (const human of ['0', '0.000001', '1', '1.5', '42.123456789', '84250.5', '99999.999']) {
            const unit = { baseDecimals, quoteDecimals, tickSize, lotSize: 1n };
            const [down, nearest, up] = (['down', 'nearest', 'up'] as const).map((r) => parsePerpPrice(human, unit, r));
            const [whole, fraction = ''] = human.split('.');
            const shift = quoteDecimals - baseDecimals - fraction.length;
            /* exact ticks = num / den */
            const digits = BigInt(whole! + fraction);
            const num = shift >= 0 ? digits * 10n ** BigInt(shift) : digits;
            const den = shift >= 0 ? tickSize : tickSize * 10n ** BigInt(-shift);
            const where = `${human} at ${baseDecimals}/${quoteDecimals} tick ${tickSize}`;
            expect(down % tickSize, where).toBe(0n);
            expect((down / tickSize) * den <= num && num <= (up / tickSize) * den, where).toBe(true);
            expect(up - down === 0n || up - down === tickSize, where).toBe(true);
            expect(nearest === down || nearest === up, where).toBe(true);
            /* nearest picks the closer side, ties up. */
            if (up !== down) expect(nearest, where).toBe(2n * num >= (2n * (down / tickSize) + 1n) * den ? up : down);
          }
        }
      }
    }
  });
});

describe('JSON-safe values', () => {
  it('turns bigints, bytes, sets and errors into JSON', () => {
    expect(toJsonSafe({ a: 1n, b: new Uint8Array([1, 255]), c: new Set([2n]), d: () => 1, e: undefined, f: [null, -3n] })).toEqual({ a: '1', b: '01ff', c: ['2'], f: [null, '-3'] });
  });
});
