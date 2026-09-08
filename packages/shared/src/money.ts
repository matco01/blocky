/**
 * Money primitives.
 *
 * Two rules, and they are not negotiable:
 *
 *  1. A `number` never touches a monetary value. Not for balances, not for USD,
 *     not "just for display". 0.1 + 0.2 !== 0.3 and users notice.
 *  2. Exact on-chain quantities are bigint in a token's smallest unit, and cross
 *     process boundaries as decimal *strings* (JSON has no bigint).
 *
 * Everything here is deliberately dependency-free so `@blocky/shared` can be
 * imported by the Expo app, the API, and any future surface without dragging a
 * chain library along.
 */

/** Number of decimal places used for internal USD arithmetic. */
export const USD_DECIMALS = 6;

const DECIMAL_RE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** True if `value` is a non-negative decimal string we are willing to do math on. */
export function isDecimalString(value: string): boolean {
  return DECIMAL_RE.test(value);
}

/**
 * Convert a human decimal string into base units.
 *
 * Strict on purpose: more precision than the token supports is an error rather
 * than a silent truncation, because silently dropping digits off the end of a
 * user's amount is exactly the kind of bug that costs someone money.
 */
export function parseUnits(value: string, decimals: number): bigint {
  if (!isDecimalString(value)) {
    throw new Error(`Not a valid decimal amount: ${JSON.stringify(value)}`);
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`Unsupported decimals: ${decimals}`);
  }

  const dot = value.indexOf('.');
  const whole = dot === -1 ? value : value.slice(0, dot);
  const frac = dot === -1 ? '' : value.slice(dot + 1);

  if (frac.length > decimals) {
    throw new Error(
      `${value} has ${frac.length} decimal places but this token supports ${decimals}`,
    );
  }

  return BigInt(whole + frac.padEnd(decimals, '0'));
}

/** Convert base units back to a human decimal string, with trailing zeros trimmed. */
export function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, '0');

  const whole = digits.slice(0, digits.length - decimals);
  const frac = decimals > 0 ? digits.slice(digits.length - decimals).replace(/0+$/, '') : '';

  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** Parse a USD decimal string into fixed-point base units. */
export function parseUsd(value: string): bigint {
  return parseUnits(value, USD_DECIMALS);
}

/** Format fixed-point USD base units back to a decimal string. */
export function formatUsd(value: bigint): string {
  return formatUnits(value, USD_DECIMALS);
}

/**
 * Render a USD amount for display: always two decimal places, grouped thousands.
 *
 * Rounds half-up, which matches what people expect when they see a price.
 */
export function displayUsd(value: string | bigint): string {
  const base = typeof value === 'string' ? parseUsd(value) : value;

  const scale = 10n ** BigInt(USD_DECIMALS - 2);
  const negative = base < 0n;
  const abs = negative ? -base : base;

  // Round half-up to cents.
  const cents = (abs + scale / 2n) / scale;
  const whole = cents / 100n;
  const remainder = cents % 100n;

  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return `${negative ? '-' : ''}$${grouped}.${remainder.toString().padStart(2, '0')}`;
}

/**
 * Multiply a token quantity by a USD unit price to get a USD value.
 *
 * `amount` is in base units of a token with `decimals`; `unitPrice` is the USD
 * price of one whole token. Returns fixed-point USD base units.
 */
export function usdValueOf(amount: bigint, decimals: number, unitPrice: string): bigint {
  return (amount * parseUsd(unitPrice)) / 10n ** BigInt(decimals);
}

/** Inverse of {@link usdValueOf}: how many base units of a token is `usd` worth. */
export function tokenAmountForUsd(usd: string, decimals: number, unitPrice: string): bigint {
  const price = parseUsd(unitPrice);
  if (price === 0n) {
    throw new Error('Cannot convert USD to a token with no known price');
  }
  return (parseUsd(usd) * 10n ** BigInt(decimals)) / price;
}

/** Sum a list of USD decimal strings without ever going through a float. */
export function sumUsd(values: readonly string[]): string {
  return formatUsd(values.reduce((total, value) => total + parseUsd(value), 0n));
}
