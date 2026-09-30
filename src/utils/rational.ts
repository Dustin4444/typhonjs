import type { Rational } from "../types";

/**
 * An exact non-negative fraction, the denominator always positive.
 */
export type Fraction = { numerator: bigint; denominator: bigint };

const DECIMAL = /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
const FRACTION = /^(\d+)\s*\/\s*(\d+)$/;

// keeps a decimal like "1e999999" from expanding into an enormous bigint
const MAX_SCALE = 1000;

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a;
  let y = b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
};

const integer = (value: number | bigint, name: string): bigint => {
  if (typeof value === "bigint") return value;
  if (Number.isSafeInteger(value)) return BigInt(value);
  throw new TypeError(`${name} must hold integers, got ${value}`);
};

// a decimal is taken in lowest terms: "0.50" is 1/2
const parseDecimal = (text: string, name: string): Fraction => {
  const match = DECIMAL.exec(text);
  if (!match || (!match[1] && !match[2])) {
    throw new TypeError(`${name} is not a non-negative number: ${text}`);
  }
  const [, whole, fraction = "", exponent = "0"] = match;
  const scale = fraction.length - Number(exponent);
  if (Math.abs(scale) > MAX_SCALE) {
    throw new RangeError(`${name} is out of range: ${text}`);
  }
  const digits = BigInt(`${whole}${fraction}`);
  const numerator = scale >= 0 ? digits : digits * 10n ** BigInt(-scale);
  const denominator = scale >= 0 ? 10n ** BigInt(scale) : 1n;
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
};

/**
 * Reads a {@link Rational} exactly. A pair or an "n/d" string is kept as written, a decimal
 * number or string is converted to lowest terms. A `number` is read as the shortest decimal
 * that round-trips, i.e. as written: 0.0577 is 577/10000, not its binary expansion.
 */
export const toFraction = (value: Rational, name = "value"): Fraction => {
  let fraction: Fraction;
  if (Array.isArray(value)) {
    if (value.length !== 2) {
      throw new TypeError(`${name} must be a [numerator, denominator] pair`);
    }
    fraction = { numerator: integer(value[0], name), denominator: integer(value[1], name) };
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${name} is not a finite number: ${value}`);
    }
    fraction = parseDecimal(String(value), name);
  } else if (typeof value === "string") {
    const text = value.trim();
    const match = FRACTION.exec(text);
    fraction = match
      ? { numerator: BigInt(match[1]), denominator: BigInt(match[2]) }
      : parseDecimal(text, name);
  } else {
    throw new TypeError(`${name} must be a number, a string or a [numerator, denominator] pair`);
  }
  if (fraction.numerator < 0n || fraction.denominator <= 0n) {
    throw new RangeError(`${name} must be non-negative with a positive denominator`);
  }
  return fraction;
};

/**
 * ⌈numerator / denominator⌉ for a non-negative numerator and a positive denominator.
 */
export const ceilDiv = (numerator: bigint, denominator: bigint): bigint =>
  (numerator + denominator - 1n) / denominator;
