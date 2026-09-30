import { blake2b } from "@noble/hashes/blake2.js";
import { decode, decodeAnnotated } from "@stricahq/cbors";
import { utils } from "../../src";
import type { Transaction } from "../../src";

/**
 * A built transaction decoded back with cbors: body and witness set as Maps keyed by their
 * CDDL numbers, plus the exact bytes of the body.
 */
export const decodeTx = (tx: Transaction) => {
  const { hash, payload } = tx.buildTransaction();
  const bytes = utils.fromHex(payload);
  const [body, witnesses, isValid, auxiliaryData] = decode(bytes) as [
    Map<number, any>,
    Map<number, any>,
    boolean,
    unknown,
  ];
  const bodyBytes = decodeAnnotated(bytes).at(0)!.bytes;
  return { hash, payload, body, witnesses, isValid, auxiliaryData, bodyBytes };
};

export const blake2b256 = (bytes: Uint8Array) => blake2b(bytes, { dkLen: 32 });
