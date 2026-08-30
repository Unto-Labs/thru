const U64_MAX = (1n << 64n) - 1n;

export interface ClobMarketPriceUnits {
  baseDecimals: number;
  quoteDecimals: number;
}

/* A CLOB price is stored as raw quote units per raw base unit. Convert at
   application boundaries so a price always reads as whole-token quote per
   whole-token base. */
export function formatClobMarketPrice(
  rawPrice: string | bigint,
  units: ClobMarketPriceUnits,
): string {
  assertDecimals(units.baseDecimals);
  assertDecimals(units.quoteDecimals);
  const raw = typeof rawPrice === 'bigint' ? rawPrice : parseUnsigned(rawPrice, 'CLOB price');
  const decimalShift = units.quoteDecimals - units.baseDecimals;
  if (decimalShift <= 0) return (raw * 10n ** BigInt(-decimalShift)).toString();

  const scale = 10n ** BigInt(decimalShift);
  const whole = raw / scale;
  const fraction = (raw % scale).toString().padStart(decimalShift, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function parseClobMarketPrice(
  displayPrice: string,
  units: ClobMarketPriceUnits,
): bigint {
  assertDecimals(units.baseDecimals);
  assertDecimals(units.quoteDecimals);
  const trimmed = displayPrice.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) throw new Error('Price must be a positive number');

  const decimalShift = units.quoteDecimals - units.baseDecimals;
  const whole = BigInt(match[1]!);
  const fraction = match[2] ?? '';
  let raw: bigint;
  if (decimalShift >= 0) {
    if (fraction.length > decimalShift) {
      throw new Error(`Price supports at most ${decimalShift} decimal places`);
    }
    raw = whole * 10n ** BigInt(decimalShift)
      + BigInt(fraction.padEnd(decimalShift, '0') || '0');
  } else {
    if (fraction) throw new Error('Price must be a whole number');
    const divisor = 10n ** BigInt(-decimalShift);
    if (whole % divisor !== 0n) {
      throw new Error(`Price must be a multiple of ${divisor}`);
    }
    raw = whole / divisor;
  }

  if (raw <= 0n) throw new Error('Price must be greater than zero');
  if (raw > U64_MAX) throw new Error('Price exceeds the CLOB limit');
  return raw;
}

export function clobMarketPriceNumber(
  rawPrice: string | bigint,
  units: ClobMarketPriceUnits,
): number {
  return Number(formatClobMarketPrice(rawPrice, units));
}

function parseUnsigned(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be an unsigned integer`);
  return BigInt(value);
}

function assertDecimals(decimals: number): void {
  if (!Number.isSafeInteger(decimals) || decimals < 0) {
    throw new Error('Token decimals are invalid');
  }
}
