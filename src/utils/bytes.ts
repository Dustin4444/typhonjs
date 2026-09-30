// ASCII codes of the two hex digits of every byte value
const HEX_HI = new Uint8Array(256);
const HEX_LO = new Uint8Array(256);
for (let i = 0; i < 256; i += 1) {
  const digits = i.toString(16).padStart(2, "0");
  HEX_HI[i] = digits.charCodeAt(0);
  HEX_LO[i] = digits.charCodeAt(1);
}
const ascii = new TextDecoder();

const NON_HEX = /[^0-9a-fA-F]/;

/**
 * Lowercase hex of any Uint8Array, Node buffers included.
 */
export const toHex = (bytes: Uint8Array): string => {
  const length = bytes.length;
  const digits = new Uint8Array(length * 2);
  for (let i = 0; i < length; i += 1) {
    const byte = bytes[i];
    digits[2 * i] = HEX_HI[byte];
    digits[2 * i + 1] = HEX_LO[byte];
  }
  return ascii.decode(digits);
};

/**
 * Bytes of a hex string, either case. Throws on an odd length or a non-hex character.
 * Errors don't include the input, which could be a private key or a large script.
 */
export const fromHex = (hex: string): Uint8Array => {
  if (typeof hex !== "string") {
    throw new TypeError(`Invalid hex string: expected a string, got ${typeof hex}`);
  }
  const bad = hex.search(NON_HEX);
  if (bad !== -1) {
    throw new TypeError(
      `Invalid hex string: non-hex character ${JSON.stringify(hex[bad])} at index ${bad}`
    );
  }
  if (hex.length % 2 !== 0) {
    throw new TypeError(`Invalid hex string: length ${hex.length} is odd`);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  }
  return bytes;
};

export const concatBytes = (...parts: Array<Uint8Array>): Uint8Array => {
  let length = 0;
  for (const part of parts) length += part.length;
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

/**
 * Canonical CBOR order of two encoded items: shorter first, then bytewise.
 */
export const compareCanonicalBytes = (a: Uint8Array, b: Uint8Array): number => {
  if (a.length !== b.length) return a.length - b.length;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
};

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

/**
 * CRC-32 (IEEE), the checksum of a Byron address.
 */
export const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
