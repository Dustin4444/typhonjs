import { CborTag, decode, encode } from "@stricahq/cbors";
import { bech32 } from "bech32";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { address as A, types, utils } from "../src";
import * as scenarios from "./helpers/scenarios";

const { fromHex, toHex } = utils;

describe("address strings", () => {
  it("reads a bech32 address that is also valid base58 as bech32", () => {
    // no "0" or "l", so base58 decodes it too
    const address = utils.getAddressFromString(
      "addr1vy8mhujsea8md9ma8w9j2fwkwzzkss4ch7yu2cna4t72cpsxuhgxq"
    );
    expect(address).toBeInstanceOf(A.EnterpriseAddress);
    expect(toHex((address as A.EnterpriseAddress).paymentCredential.hash)).toBe(
      "0fbbf250cf4fb6977d3b8b2525d670856842b8bf89c5627daafcac06"
    );
  });

  it("checks the checksum of a Byron address", () => {
    const byron = scenarios.cip19[13];
    expect(utils.getAddressFromString(byron)).toBeInstanceOf(A.ByronAddress);
    const [payload, crc] = decode(bs58.decode(byron)) as [CborTag, number];
    const corrupted = bs58.encode(encode([payload, (crc + 1) % 2 ** 32]));
    expect(() => utils.getAddressFromString(corrupted)).toThrow("Invalid Address");
  });

  it("rejects a bech32 prefix that doesn't match the address", () => {
    const bech32Of = (prefix: string, hex: string) =>
      bech32.encode(prefix, bech32.toWords(fromHex(hex)), 1000);
    const testnet = `60${"11".repeat(28)}`;
    const mainnet = `61${"11".repeat(28)}`;
    const reward = `e1${"11".repeat(28)}`;
    expect(utils.getAddressFromString(bech32Of("addr_test", testnet)).getHex()).toBe(testnet);
    expect(utils.getAddressFromString(bech32Of("addr", mainnet).toUpperCase()).getHex()).toBe(
      mainnet
    );
    for (const input of [
      bech32Of("addr", testnet),
      bech32Of("addr_test", mainnet),
      bech32Of("stake", mainnet),
      bech32Of("addr", reward),
      bech32Of("addr", toHex(bs58.decode(scenarios.cip19[13]))),
    ]) {
      expect(() => utils.getAddressFromString(input), input).toThrow("Invalid Address");
    }
  });

  it("rejects strings that are no address", () => {
    for (const input of [
      "",
      "3mJr7AoUXx2Wqd",
      bs58.encode(encode(1)),
      "pool1pu5jlj4q9w9jlxeu370a3c9myx47md5j5m2str0naunn2q3lkdy",
      scenarios.cip19[0].slice(0, -1),
    ]) {
      expect(() => utils.getAddressFromString(input), input).toThrow("Invalid Address");
    }
  });
});

describe("address bytes", () => {
  it("takes the bytes or their hex", () => {
    const hex = "61e1aaaca245ff5ac32e4fc3010d26ac818f6c2169ee80ab0bedb800f4";
    expect(utils.getAddressFromHex(hex).getBech32()).toBe(
      utils.getAddressFromHex(fromHex(hex)).getBech32()
    );
  });

  it("reads the network id from the low nibble of the header", () => {
    const address = utils.getAddressFromHex(`63${"11".repeat(28)}`) as A.EnterpriseAddress;
    expect(address.getNetworkId()).toBe(3);
    expect(address.paymentCredential.type).toBe(types.HashType.ADDRESS);
  });

  it("rejects bytes of the wrong length or type", () => {
    expect(() => utils.getAddressFromHex(new Uint8Array(0))).toThrow();
    expect(() => utils.getAddressFromHex(`01${"11".repeat(28)}`)).toThrow(/length/);
    expect(() => utils.getAddressFromHex(`61${"11".repeat(29)}`)).toThrow(/length/);
    expect(() => utils.getAddressFromHex(`e1${"11".repeat(27)}`)).toThrow(/length/);
    expect(() => utils.getAddressFromHex(`41${"11".repeat(28)}`)).toThrow(/length/);
    expect(() => utils.getAddressFromHex(`91${"11".repeat(28)}`)).toThrow(/Unsupported/);
  });

  it("does not share memory with the bytes it was read from", () => {
    const bytes = fromHex(`01${"11".repeat(28)}${"22".repeat(28)}`);
    const address = utils.getAddressFromHex(bytes) as A.BaseAddress;
    bytes.fill(0);
    expect(toHex(address.paymentCredential.hash)).toBe("11".repeat(28));
    expect(toHex(address.stakeCredential.hash)).toBe("22".repeat(28));

    const byronBytes = bs58.decode(scenarios.cip19[13]);
    const byron = utils.getAddressFromHex(byronBytes);
    byronBytes.fill(0);
    expect(byron.getBech32()).toBe(scenarios.cip19[13]);
    expect(bs58.encode(byron.getBytes())).toBe(scenarios.cip19[13]);
  });

  it("checks the checksum of Byron address bytes", () => {
    const [payload, crc] = decode(bs58.decode(scenarios.cip19[13])) as [CborTag, number];
    expect(() => utils.getAddressFromHex(encode([payload, (crc + 1) % 2 ** 32]))).toThrow(
      /Invalid Byron address/
    );
    expect(() => utils.getAddressFromHex("82deadbeef")).toThrow(/Invalid Byron address/);
  });
});
