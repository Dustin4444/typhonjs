import { CborTag, decode, encode } from "@stricahq/cbors";
import bs58 from "bs58";
import { bech32 } from "bech32";
import { maxAdaAmount, maxTokenAmount } from "../constants";
import BaseAddress from "../address/BaseAddress";
import ByronAddress from "../address/ByronAddress";
import EnterpriseAddress from "../address/EnterpriseAddress";
import PointerAddress from "../address/PointerAddress";
import RewardAddress from "../address/RewardAddress";
import { getUniqueTokens } from "./helpers";
import { HashType } from "../types";
import type {
  NetworkId,
  Token,
  Credential,
  CardanoAddress,
  AuxiliaryData,
  PlutusData,
  Output,
} from "../types";
import { encodeAuxiliaryData, encodeOutput, encodePlutusData, encodeOutputTokens } from "./encoder";
import type { EncodedAmount } from "../internal-types";
import { crc32, fromHex, toHex } from "./bytes";

export { fromHex, toHex } from "./bytes";

export const getOutputValueSize = (adaAmount: bigint, tokens: Array<Token>): number => {
  const encodedAmount: EncodedAmount =
    tokens.length > 0 ? [adaAmount, encodeOutputTokens(tokens)] : adaAmount;
  return encode(encodedAmount).length;
};

/**
 * Minimum ADA of an output before the Babbage era, from lovelace per UTxO word.
 */
export const calculateMinUtxoAmount = (
  tokens: Array<Token>,
  lovelacePerUtxoWord: bigint,
  hasPlutusDataHash?: boolean
): bigint => {
  const uniqueTokens = getUniqueTokens(tokens);
  const roundupBytesToWords = (x: number) => Math.floor((x + 7) / 8);
  const coinSize = 2;
  let utxoEntrySizeWithoutVal = 27;
  if (hasPlutusDataHash) {
    utxoEntrySizeWithoutVal += 10;
  }
  const adaOnlyUtxoSize = utxoEntrySizeWithoutVal + coinSize;

  // sumAssetNameLengths must be computed per-policy: the same asset name stored under
  // two different policies occupies space in two separate CBOR maps, so it counts twice.
  // ref: https://cardano-ledger.readthedocs.io/en/latest/explanations/min-utxo-mary.html
  const policyAssetNames = new Map<string, Set<string>>();
  for (const { policyId, assetName } of uniqueTokens) {
    const assetNames = policyAssetNames.get(policyId) ?? new Set();
    assetNames.add(assetName);
    policyAssetNames.set(policyId, assetNames);
  }
  const policyCount = policyAssetNames.size;
  // Empty asset names (0-char) contribute 0 bytes per spec (sumAssetNameLengths).
  let assetNameSize = 0;
  for (const assetNames of policyAssetNames.values()) {
    for (const assetName of assetNames) {
      assetNameSize += fromHex(assetName).length;
    }
  }

  const policyIdSize = 28;

  const size =
    6 + roundupBytesToWords(uniqueTokens.length * 12 + assetNameSize + policyCount * policyIdSize);

  const minUtxo = lovelacePerUtxoWord * BigInt(adaOnlyUtxoSize);

  if (uniqueTokens.length === 0) {
    return minUtxo;
  }
  const minUtxoWithTokens = lovelacePerUtxoWord * BigInt(utxoEntrySizeWithoutVal + size);
  return minUtxoWithTokens > minUtxo ? minUtxoWithTokens : minUtxo;
};

/**
 * Minimum ADA of an output since the Babbage era: (160 + output size) * coins per UTxO byte.
 * The output is sized with the largest possible ADA amount, so the result holds for any amount.
 */
export const calculateMinUtxoAmountBabbage = (output: Output, utxoCostPerByte: bigint): bigint => {
  const sizeOutput: Output = { ...output, amount: maxAdaAmount };
  return BigInt(160 + encode(encodeOutput(sizeOutput)).length) * utxoCostPerByte;
};

// a Shelley address payload is one or two 28-byte credential hashes
const HASH_SIZE = 28;

const credential = (hash: Uint8Array, type: HashType): Credential => ({ hash, type }) as Credential;

const checkLength = (bytes: Uint8Array, valid: boolean) => {
  if (!valid) {
    throw new Error(`Invalid address length: ${bytes.length} bytes`);
  }
};

// a Byron address is [tag 24 (payload), crc32 of the payload]
const isByronAddress = (bytes: Uint8Array): boolean => {
  try {
    const decoded = decode(bytes);
    if (!Array.isArray(decoded) || decoded.length !== 2) {
      return false;
    }
    const [payload, checksum] = decoded;
    return (
      payload instanceof CborTag &&
      payload.tag === 24 &&
      payload.value instanceof Uint8Array &&
      crc32(payload.value) === checksum
    );
  } catch {
    return false;
  }
};

/**
 * The address held in raw address bytes (or their hex).
 */
export const getAddressFromHex = (hexAddress: Uint8Array | string): CardanoAddress => {
  const bytes = typeof hexAddress === "string" ? fromHex(hexAddress) : hexAddress;
  if (bytes.length === 0) {
    throw new Error("Unsupported address type");
  }
  const addressType = bytes[0] >> 4;
  const networkId = (bytes[0] & 0x0f) as NetworkId;
  // copies, so the address never aliases the caller's buffer
  const firstHash = () => bytes.slice(1, 1 + HASH_SIZE);
  const secondHash = () => bytes.slice(1 + HASH_SIZE, 1 + 2 * HASH_SIZE);

  switch (addressType) {
    case 0b1110:
    case 0b1111: {
      checkLength(bytes, bytes.length === 1 + HASH_SIZE);
      const type = addressType === 0b1111 ? HashType.SCRIPT : HashType.ADDRESS;
      return new RewardAddress(networkId, credential(firstHash(), type));
    }
    case 0b0110:
    case 0b0111: {
      checkLength(bytes, bytes.length === 1 + HASH_SIZE);
      const type = addressType === 0b0111 ? HashType.SCRIPT : HashType.ADDRESS;
      return new EnterpriseAddress(networkId, credential(firstHash(), type));
    }
    case 0b0100:
    case 0b0101: {
      // at least one byte for each of the three numbers of the pointer
      checkLength(bytes, bytes.length >= 1 + HASH_SIZE + 3);
      const type = addressType === 0b0101 ? HashType.SCRIPT : HashType.ADDRESS;
      const vlq = toHex(bytes.subarray(1 + HASH_SIZE));
      return new PointerAddress(networkId, credential(firstHash(), type), vlq);
    }
    case 0b0000:
    case 0b0001:
    case 0b0010:
    case 0b0011: {
      checkLength(bytes, bytes.length === 1 + 2 * HASH_SIZE);
      // bit 4 of the header flags a script payment credential, bit 5 a script stake credential
      const paymentType = addressType & 0b01 ? HashType.SCRIPT : HashType.ADDRESS;
      const stakeType = addressType & 0b10 ? HashType.SCRIPT : HashType.ADDRESS;
      return new BaseAddress(
        networkId,
        credential(firstHash(), paymentType),
        credential(secondHash(), stakeType)
      );
    }
    case 0b1000:
      if (!isByronAddress(bytes)) {
        throw new Error("Invalid Byron address");
      }
      return new ByronAddress(bytes.slice());
    default:
      throw new Error("Unsupported address type");
  }
};

export const decodeBech32 = (bech32Address: string): { prefix: string; value: Uint8Array } => {
  const decoded = bech32.decode(bech32Address, 114);
  return {
    prefix: decoded.prefix,
    value: Uint8Array.from(bech32.fromWords(decoded.words)),
  };
};

/**
 * The address of a bech32 (Shelley) or base58 (Byron) address string. A bech32 prefix has to
 * match the address it holds: `addr` or `stake`, with `_test` off mainnet.
 */
export const getAddressFromString = (address: string): CardanoAddress => {
  let decoded: { prefix: string; value: Uint8Array } | undefined;
  try {
    decoded = decodeBech32(address);
  } catch {
    decoded = undefined;
  }
  if (decoded) {
    let parsed: CardanoAddress;
    try {
      parsed = getAddressFromHex(decoded.value);
    } catch {
      throw new Error("Invalid Address");
    }
    if (parsed.getBech32() !== address.toLowerCase()) {
      throw new Error("Invalid Address");
    }
    return parsed;
  }

  let bytes: Uint8Array | undefined;
  try {
    bytes = bs58.decode(address);
  } catch {
    bytes = undefined;
  }
  if (bytes && isByronAddress(bytes)) {
    return new ByronAddress(bytes);
  }
  throw new Error("Invalid Address");
};

/**
 * Splits tokens into sets that each fit in an output within the max value size. A token
 * holding more than an output can is split over several sets.
 */
export const getMaximumTokenSets = (
  oTokens: Array<Token>,
  maxValueSizePP: number
): Array<Array<Token>> => {
  const tokens = oTokens.map((token) => ({ ...token }));
  const result: Array<Array<Token>> = [];
  while (tokens.length > 0) {
    const tokenArray: Array<Token> = [];
    const tokenLengthFixed = tokens.length;
    for (let i = 0; i < tokenLengthFixed; i += 1) {
      const token = tokens.shift() as Token;
      // if the token amount is more than the max amount (int), only use max amount token
      // add remaining amount of tokens into another output set
      const newToken = token.amount > maxTokenAmount ? { ...token, amount: maxTokenAmount } : token;

      // calculate the current token set size
      const tokenArrayOutputSize = getOutputValueSize(maxAdaAmount, [...tokenArray, newToken]);

      // only add the token to the current set if its under maxValueSize limit
      if (tokenArrayOutputSize < maxValueSizePP) {
        tokenArray.push(newToken);

        // if the above token used in this set had more than max value
        // add the remaining token amount for the next set
        if (token.amount > maxTokenAmount) {
          tokens.push({ ...token, amount: token.amount - maxTokenAmount });
        }
      } else {
        // add the popped token back to main list, since it didn't make it into the current set
        tokens.push(token);
      }
      // while modifying this func, make sure to handle the case above, no logic must follow this line
    }
    if (tokenArray.length === 0) {
      throw new Error("Token does not fit in an output within maxValueSize");
    }
    result.push(tokenArray);
  }
  return result;
};

export const createAuxiliaryDataCbor = (auxiliaryData: AuxiliaryData): Uint8Array => {
  const encodedAuxData = encodeAuxiliaryData(auxiliaryData);
  return encode(encodedAuxData);
};

export const createPlutusDataCbor = (plutusData: PlutusData): Uint8Array => {
  const encodedPlutusData = encodePlutusData(plutusData);
  return encode(encodedPlutusData);
};
