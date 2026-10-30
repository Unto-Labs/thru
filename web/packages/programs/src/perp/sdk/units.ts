/* Units.

   On chain everything is an integer:
     - a price is quote atoms per base atom, a multiple of the market's tick
       size (tickSize, in the same unit);
     - a size (quantity) is base atoms, a multiple of the lot size;
     - positions and resting orders are stored in lots.
   A human price is quote per base unit: priceAtoms / 10^(quoteDecimals -
   baseDecimals).  All conversions here are exact bigint arithmetic; only
   format/parse touch strings. */

export function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

/** Scales an integer by 10^exponent, truncating toward zero for negatives. */
export function scaleByPow10(value: bigint, exponent: number): bigint {
  return exponent >= 0 ? value * pow10(exponent) : value / pow10(-exponent);
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export interface FormatUnitsOptions {
  /** Fraction digits kept (default: all significant, trailing zeros removed). */
  maxFraction?: number;
  /** Fraction digits always shown. */
  minFraction?: number;
  /** Thousands separators in the whole part (default true; logs and
      machine-readable output pass false). */
  group?: boolean;
}

export function formatUnits(amount: bigint, decimals: number, options: FormatUnitsOptions = {}): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const scale = pow10(decimals);
  const whole = abs / scale;
  let fraction = (abs % scale).toString().padStart(decimals, '0');
  const maxFraction = options.maxFraction ?? decimals;
  if (fraction.length > maxFraction) fraction = fraction.slice(0, maxFraction);
  fraction = fraction.replace(/0+$/, '');
  const minFraction = options.minFraction ?? 0;
  if (fraction.length < minFraction) fraction = fraction.padEnd(minFraction, '0');
  const wholeText = options.group === false ? whole.toString() : groupThousands(whole.toString());
  return `${negative ? '-' : ''}${wholeText}${fraction ? `.${fraction}` : ''}`;
}

export function parseUnits(value: string, decimals: number): bigint {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value.trim().replace(/,/g, ''));
  if (!match) throw new Error(`invalid amount "${value}"`);
  const fraction = match[2] ?? '';
  if (fraction.length > decimals) throw new Error(`amount ${value} has more than ${decimals} decimals`);
  return BigInt(match[1]!) * pow10(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
}

/** Prices are quote atoms per base atom = quote × 10^(quoteDecimals − baseDecimals). */
export function formatPrice(priceAtoms: bigint, market: { quoteDecimals: number; baseDecimals: number }, options: FormatUnitsOptions = {}): string {
  const shift = market.quoteDecimals - market.baseDecimals;
  return shift < 0 ? formatUnits(priceAtoms * pow10(-shift), 0, options) : formatUnits(priceAtoms, shift, options);
}

export function roundToTick(priceAtoms: bigint, tickSize: bigint): bigint {
  return (priceAtoms / tickSize) * tickSize;
}

export type PerpRounding = 'exact' | 'down' | 'up' | 'nearest';

function divide(value: bigint, step: bigint, rounding: PerpRounding, label: string): bigint {
  if (step <= 0n) throw new Error(`${label} step must be positive`);
  if (value < 0n) throw new Error(`${label} must not be negative`);
  const quotient = value / step;
  const remainder = value % step;
  if (remainder === 0n) return quotient;
  switch (rounding) {
    case 'exact':
      throw new Error(`${label} ${value} is not a multiple of ${step}`);
    case 'down':
      return quotient;
    case 'up':
      return quotient + 1n;
    case 'nearest':
      return remainder * 2n >= step ? quotient + 1n : quotient;
  }
}

/** Ticks of a price (quote atoms per base atom): price / tickSize. */
export function perpPriceToTicks(price: bigint, tickSize: bigint, rounding: PerpRounding = 'exact'): bigint {
  return divide(price, tickSize, rounding, 'price');
}

export function perpTicksToPrice(ticks: bigint, tickSize: bigint): bigint {
  return ticks * tickSize;
}

/** Lots of a size (base atoms): quantity / lotSize. */
export function perpSizeToLots(quantity: bigint, lotSize: bigint, rounding: PerpRounding = 'exact'): bigint {
  return divide(quantity, lotSize, rounding, 'size');
}

export function perpLotsToSize(lots: bigint, lotSize: bigint): bigint {
  return lots * lotSize;
}

/** A price rounded onto the tick grid. */
export function perpRoundPrice(price: bigint, tickSize: bigint, rounding: Exclude<PerpRounding, 'exact'> = 'nearest'): bigint {
  return perpPriceToTicks(price, tickSize, rounding) * tickSize;
}

export interface PerpUnitMarket {
  /** Quote atoms per base atom, as bigint or decimal string. */
  tickSize: bigint | string;
  /** Base atoms. */
  lotSize: bigint | string;
  baseDecimals: number;
  quoteDecimals: number;
}

/** A non-negative decimal string as the exact fraction digits / 10^scale. */
function parseDecimal(value: string): { digits: bigint; scale: number } {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value.trim().replace(/,/g, ''));
  if (!match) throw new Error(`invalid amount "${value}"`);
  const fraction = match[2] ?? '';
  return { digits: BigInt(match[1]! + fraction), scale: fraction.length };
}

/** human × 10^shift / step rounded once onto whole steps: the exact ratio
    is rounded, never a value already truncated to whole atoms. */
function humanToSteps(human: string, shift: number, step: bigint, rounding: Exclude<PerpRounding, 'exact'>, label: string): bigint {
  const { digits, scale } = parseDecimal(human);
  const exponent = shift - scale;
  const numerator = exponent >= 0 ? digits * pow10(exponent) : digits;
  const denominator = exponent >= 0 ? step : step * pow10(-exponent);
  return divide(numerator, denominator, rounding, label);
}

/** "84250.5" (quote per base unit) as an on-chain price on the tick grid.
    'exact' fails unless the price is a whole number of ticks; the other
    modes round the exact human price onto the grid. */
export function parsePerpPrice(human: string, market: PerpUnitMarket, rounding: PerpRounding = 'exact'): bigint {
  const shift = market.quoteDecimals - market.baseDecimals;
  const tickSize = BigInt(market.tickSize);
  if (rounding !== 'exact') return humanToSteps(human, shift, tickSize, rounding, 'price') * tickSize;
  let atoms: bigint;
  if (shift >= 0) {
    atoms = parseUnits(human, shift);
  } else {
    const whole = parseUnits(human, 0);
    if (whole % pow10(-shift) !== 0n) throw new Error(`price ${human} is finer than one quote atom per base atom`);
    atoms = whole / pow10(-shift);
  }
  return perpPriceToTicks(atoms, tickSize, 'exact') * tickSize;
}

/** "0.25" (base units) as an on-chain quantity in base atoms, a whole
    number of lots. 'exact' fails unless the size is a whole number of lots;
    the other modes round the exact human size onto the lot grid. */
export function parsePerpSize(human: string, market: PerpUnitMarket, rounding: PerpRounding = 'exact'): bigint {
  const lotSize = BigInt(market.lotSize);
  if (rounding !== 'exact') return humanToSteps(human, market.baseDecimals, lotSize, rounding, 'size') * lotSize;
  return perpSizeToLots(parseUnits(human, market.baseDecimals), lotSize, 'exact') * lotSize;
}

export function formatPerpPrice(price: bigint, market: Pick<PerpUnitMarket, 'baseDecimals' | 'quoteDecimals'>, options?: FormatUnitsOptions): string {
  return formatPrice(price, market, options);
}

export function formatPerpSize(quantity: bigint, market: Pick<PerpUnitMarket, 'baseDecimals'>, options?: FormatUnitsOptions): string {
  return formatUnits(quantity, market.baseDecimals, options);
}
