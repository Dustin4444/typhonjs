import { describe, expect, it } from "vitest";
import { NativeScriptFactory, PlutusDataFactory, address as A, utils } from "../src";
import type { CardanoAddress, Output, Token } from "../src/types";
import * as stub from "./stub";
import * as scenarios from "./helpers/scenarios";

const { toHex } = utils;

const formatSets = (sets: Array<Array<Token>>) =>
  sets.map((set) => set.map((t) => `${t.policyId.slice(0, 2)}.${t.assetName}.${t.amount}`));

describe("transactions", () => {
  for (const [name, build] of Object.entries(scenarios.transactions)) {
    it(name, () => {
      const tx = build();
      const { hash, payload } = tx.buildTransaction();
      expect(toHex(tx.getTransactionHash())).toBe(hash);
      expect({ hash, fee: tx.getFee(), payload }).toMatchSnapshot();
    });
  }
});

it("addresses", () => {
  const parsed = scenarios.cip19.map((input) => {
    const address = utils.getAddressFromString(input) as CardanoAddress & {
      getNetworkId?: () => number;
      paymentCredential?: { hash: Uint8Array; type: number };
      stakeCredential?: { hash: Uint8Array; type: number };
    };
    return {
      input,
      cls: address.constructor.name,
      hex: address.getHex(),
      bech32: address.getBech32(),
      ...(address.getNetworkId ? { network: address.getNetworkId() } : {}),
      ...(address.paymentCredential
        ? { payment: [toHex(address.paymentCredential.hash), address.paymentCredential.type] }
        : {}),
      ...(address.stakeCredential
        ? { stake: [toHex(address.stakeCredential.hash), address.stakeCredential.type] }
        : {}),
    };
  });
  expect(parsed).toMatchSnapshot();
});

it("address construction", () => {
  const p = scenarios.cred("9493315cd92eb5d8c4304e67b7e16ae36d61d34502694657811a2c8e");
  const s = scenarios.cred("337b62cfff6403a06a3acbc34f8c46003c69fe79a3628cefa9c47251");
  const constructed = {
    base: new A.BaseAddress(1, p, s).getBech32(),
    baseT: new A.BaseAddress(0, p, s).getBech32(),
    ent: new A.EnterpriseAddress(1, p).getBech32(),
    rew: new A.RewardAddress(1, s).getBech32(),
    ptr: new A.PointerAddress(1, p, "8198bd431b03").getBech32(),
    baseScript: new A.BaseAddress(1, scenarios.scriptCred(scenarios.scriptHashV2), s).getHex(),
  };
  expect(constructed).toMatchSnapshot();
});

it("bech32", () => {
  const { prefix, value } = utils.decodeBech32(scenarios.cip19[0]);
  expect({ prefix, value: toHex(value) }).toMatchSnapshot();
});

it("plutus data", () => {
  const encoded = Object.fromEntries(
    Object.entries(scenarios.plutusDataCases).map(([name, data]) => {
      const factory = new PlutusDataFactory(data);
      return [name, { cbor: toHex(factory.cbor()), hash: toHex(factory.plutusDataHash()) }];
    })
  );
  expect(encoded).toMatchSnapshot();
});

it("native scripts", () => {
  const encoded = Object.fromEntries(
    Object.entries(scenarios.nativeScriptCases).map(([name, script]) => {
      const factory = new NativeScriptFactory(script);
      return [name, { cbor: toHex(factory.cbor()), policyId: toHex(factory.policyId()) }];
    })
  );
  expect(encoded).toMatchSnapshot();
});

it("native script from cli json", () => {
  const cli = NativeScriptFactory.fromCliJSON({
    type: "all",
    scripts: [
      { type: "sig", keyHash: "4eec4012a1a73ae0074028b016d1084cd9d39ac55bff0b52590dd137" },
      { type: "before", slot: 90000000 },
      { type: "atLeast", required: 1, scripts: [{ type: "after", slot: 5 }] },
    ],
  });
  const encoded = { cbor: toHex(cli.cbor()), policyId: toHex(cli.policyId()), json: cli.json() };
  expect(encoded).toMatchSnapshot();
});

it("min utxo", () => {
  const zeroBase = utils.getAddressFromHex(new Uint8Array(57));
  const outputs: Record<string, Output> = {
    plain: { address: zeroBase, amount: 10n, tokens: [] },
    tokens: { address: zeroBase, amount: 10n, tokens: stub.tokens },
    datum: { address: zeroBase, amount: 10n, tokens: [], plutusData: stub.plutusDataD1 },
    hash: { address: zeroBase, amount: 10n, tokens: [], plutusDataHash: "00".repeat(32) },
    refV2: { address: zeroBase, amount: 10n, tokens: [], plutusScript: stub.plutusScriptV2S1 },
    enterprise: {
      address: utils.getAddressFromString(scenarios.cip19[6]),
      amount: 10n,
      tokens: [stub.tokens[0]],
    },
    byron: { address: utils.getAddressFromString(scenarios.cip19[13]), amount: 10n, tokens: [] },
  };
  const babbage = Object.fromEntries(
    Object.entries(outputs).map(([name, output]) => [
      name,
      utils.calculateMinUtxoAmountBabbage(output, stub.pParams.utxoCostPerByte),
    ])
  );
  const legacy = {
    none: utils.calculateMinUtxoAmount([], stub.lovelacePerUtxoWord),
    noneHash: utils.calculateMinUtxoAmount([], stub.lovelacePerUtxoWord, true),
    tokens: utils.calculateMinUtxoAmount(stub.tokens, stub.lovelacePerUtxoWord),
    tokensHash: utils.calculateMinUtxoAmount(stub.tokens, stub.lovelacePerUtxoWord, true),
    emptyAssetName: utils.calculateMinUtxoAmount(
      [{ ...stub.tokens[0], assetName: "", amount: 1n }],
      stub.lovelacePerUtxoWord
    ),
    sameNameTwoPolicies: utils.calculateMinUtxoAmount(
      [stub.tokens[0], stub.tokens[1]].map((token) => ({
        ...token,
        assetName: "4142434445464748",
        amount: 1n,
      })),
      stub.lovelacePerUtxoWord
    ),
  };
  expect({ babbage, legacy }).toMatchSnapshot();
});

it("token sets", () => {
  const bigAmounts = [
    { policyId: "aa".repeat(28), assetName: "01", amount: 20000000000000000000n },
    { policyId: "bb".repeat(28), assetName: "", amount: 5n },
  ];
  const sets = {
    maxValueSize1000: formatSets(utils.getMaximumTokenSets(scenarios.manyTokens, 1000)),
    maxValueSize400: formatSets(utils.getMaximumTokenSets(scenarios.manyTokens, 400)),
    bigAmounts: formatSets(utils.getMaximumTokenSets(bigAmounts, 5000)),
  };
  expect(sets).toMatchSnapshot();
});

it("auxiliary data", () => {
  const cbor = toHex(utils.createAuxiliaryDataCbor(scenarios.metadata));
  expect(cbor).toMatchSnapshot();
});
