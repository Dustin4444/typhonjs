import type { NativeScript, Token } from "../types";

/**
 * The tokens with the amounts of each asset summed. Policy ids and asset names are hex, so
 * they're matched whatever their case and returned in lowercase.
 */
export const getUniqueTokens = (tokens: Array<Token>): Array<Token> => {
  const policies = new Map<string, Map<string, Token>>();
  for (const token of tokens) {
    const policyId = token.policyId.toLowerCase();
    const assetName = token.assetName.toLowerCase();
    let assets = policies.get(policyId);
    if (!assets) {
      assets = new Map();
      policies.set(policyId, assets);
    }
    const amount = (assets.get(assetName)?.amount ?? 0n) + token.amount;
    assets.set(assetName, { policyId, assetName, amount });
  }
  return [...policies.values()].flatMap((assets) => [...assets.values()]);
};

export const getTokenDiff = (
  inputToken: Array<Token>,
  outputTokens: Array<Token>
): Array<Token> => {
  const negativeValueOutputTokens = outputTokens.map((token) => ({
    ...token,
    amount: -token.amount,
  }));

  return getUniqueTokens(inputToken.concat(negativeValueOutputTokens)).filter(
    (token) => token.amount !== 0n
  );
};

const utf8 = new TextEncoder();

// metadata integers are CBOR major type 0 or 1, never bignums
const MIN_METADATA_INT = -(2n ** 64n);
const MAX_METADATA_INT = 2n ** 64n - 1n;
const MAX_METADATA_BYTES = 64;

const isPlainObject = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Checks a metadata value against the ledger's rules, and turns plain objects into maps with
 * text keys. Strings (as UTF-8) and byte strings hold at most 64 bytes, integers fit in
 * 64 bits. Anything else, a float, a boolean or null, can't be metadata and throws.
 */
export const sanitizeMetadata = (metadata: unknown): unknown => {
  if (Array.isArray(metadata)) {
    return metadata.map((d) => sanitizeMetadata(d));
  }
  if (typeof metadata === "string" || metadata instanceof Uint8Array) {
    const length = typeof metadata === "string" ? utf8.encode(metadata).length : metadata.length;
    if (length > MAX_METADATA_BYTES) {
      throw new Error("string or buffer length invalid");
    }
    return metadata;
  }
  if (typeof metadata === "number") {
    if (!Number.isSafeInteger(metadata)) {
      throw new Error(`metadata numbers must be safe integers, use a bigint for ${metadata}`);
    }
    return metadata;
  }
  if (typeof metadata === "bigint") {
    if (metadata < MIN_METADATA_INT || metadata > MAX_METADATA_INT) {
      throw new Error(`metadata integer out of range: ${metadata}`);
    }
    return metadata;
  }
  if (metadata instanceof Map) {
    const map = new Map();
    for (const [key, value] of metadata.entries()) {
      map.set(sanitizeMetadata(key), sanitizeMetadata(value));
    }
    return map;
  }
  if (typeof metadata === "object" && metadata !== null && isPlainObject(metadata)) {
    const map = new Map();
    for (const [key, value] of Object.entries(metadata)) {
      map.set(sanitizeMetadata(key), sanitizeMetadata(value));
    }
    return map;
  }
  throw new Error(`Unsupported metadata value: ${String(metadata)}`);
};

export const compareCanonically = (str1: string, str2: string): number => {
  if (str1.length !== str2.length) {
    return str1.length - str2.length;
  }
  str1 = str1.toLowerCase();
  str2 = str2.toLowerCase();
  if (str1 < str2) {
    return -1;
  }
  if (str1 > str2) {
    return 1;
  }
  return 0;
};

/**
 * Tokens in canonical CBOR order: by policy id, then by asset name, each shorter first and
 * then bytewise.
 */
export const sortTokens = (tokens: Array<Token>): Array<Token> => {
  return [...tokens].sort(
    (token1, token2) =>
      compareCanonically(token1.policyId, token2.policyId) ||
      compareCanonically(token1.assetName, token2.assetName)
  );
};

export const getPubKeyHashListFromNativeScript = (nativeScript: NativeScript): Array<string> => {
  const fromScripts = (scripts: Array<NativeScript>) =>
    scripts.flatMap((script) => getPubKeyHashListFromNativeScript(script));
  if ("pubKeyHash" in nativeScript) {
    return [nativeScript.pubKeyHash];
  }
  if ("all" in nativeScript) {
    return fromScripts(nativeScript.all);
  }
  if ("any" in nativeScript) {
    return fromScripts(nativeScript.any);
  }
  if ("n" in nativeScript) {
    return fromScripts(nativeScript.k);
  }
  return [];
};
