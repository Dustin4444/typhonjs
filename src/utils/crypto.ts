import { blake2b } from "@noble/hashes/blake2.js";

export const hash32 = (data: Uint8Array): Uint8Array => blake2b(data, { dkLen: 32 });

export const hash28 = (data: Uint8Array): Uint8Array => blake2b(data, { dkLen: 28 });
