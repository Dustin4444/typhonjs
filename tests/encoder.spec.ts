import { CborTag, decode, encode } from "@stricahq/cbors";
import { describe, expect, it } from "vitest";
import { NativeScriptFactory, PlutusDataFactory, Transaction, types, utils } from "../src";
import type { PlutusData, ProposalProcedure } from "../src/types";
import {
  encodeLanguageViews,
  encodeMint,
  encodeOutputTokens,
  encodeProtocolParamUpdate,
  encodeVotingProcedures,
  generateScriptDataHash,
  getPlutusScriptBytes,
  getPlutusScriptHash,
} from "../src/utils/encoder";
import { getPubKeyHashListFromNativeScript, sanitizeMetadata } from "../src/utils/helpers";
import { toFraction } from "../src/utils/rational";
import type { EncodedWitnesses } from "../src/internal-types";
import { blake2b256, decodeTx } from "./helpers/decode";
import * as scenarios from "./helpers/scenarios";
import * as stub from "./stub";

const { fromHex, toHex } = utils;

const plutusCbor = (data: PlutusData) => toHex(new PlutusDataFactory(data).cbor());

describe("plutus data", () => {
  it("keeps byte strings up to 64 bytes definite", () => {
    expect(plutusCbor(new Uint8Array(64).fill(9))).toBe(`5840${"09".repeat(64)}`);
  });

  it("chunks longer byte strings into 64-byte pieces, as the ledger requires", () => {
    expect(plutusCbor(new Uint8Array(65).fill(1))).toBe(`5f5840${"01".repeat(64)}4101ff`);
    const bytes = Uint8Array.from({ length: 130 }, (_, i) => i);
    const cbor = plutusCbor({ constructor: 0, fields: [bytes] });
    expect(cbor).toBe(
      `d8799f5f5840${toHex(bytes.subarray(0, 64))}5840${toHex(bytes.subarray(64, 128))}42${toHex(bytes.subarray(128))}ffff`
    );
    // a decoder joins the chunks back
    expect((decode(fromHex(cbor)) as CborTag).value[0]).toEqual(bytes);
  });

  it("writes integers beyond 64 bits as bignums", () => {
    expect(plutusCbor(2n ** 64n - 1n)).toBe("1bffffffffffffffff");
    expect(plutusCbor(-(2n ** 64n))).toBe("3bffffffffffffffff");
    expect(plutusCbor(2n ** 64n)).toBe("c249010000000000000000");
    expect(plutusCbor(-(2n ** 64n) - 1n)).toBe("c349010000000000000000");
    expect(decode(fromHex(plutusCbor(-(2n ** 64n) - 1n)))).toBe(-(2n ** 64n) - 1n);
  });

  it("chunks the bytes of a bignum longer than 64 bytes", () => {
    const value = 2n ** 520n; // 66 bytes: 01 and 65 zero bytes
    expect(plutusCbor(value)).toBe(`c25f5840${"01"}${"00".repeat(63)}420000ff`);
    expect(decode(fromHex(plutusCbor(value)))).toBe(value);
  });

  it("encodes map keys as plutus data too", () => {
    const data = new Map<PlutusData, PlutusData>([
      [{ constructor: 0, fields: [] }, 1],
      [[1, 2], 3],
    ]);
    expect(plutusCbor(data)).toBe("a2d87980019f0102ff03");
  });

  it("writes maps with a definite length and non-empty lists with an indefinite one", () => {
    const bytesKeys = new Map<PlutusData, PlutusData>([
      [fromHex("aa"), 1],
      [fromHex("bb"), { constructor: 0, fields: [] }],
    ]);
    expect(plutusCbor(bytesKeys)).toBe("a241aa0141bbd87980");
    const nested = new Map<PlutusData, PlutusData>([
      [1, [1]],
      [2, new Map()],
    ]);
    expect(plutusCbor(nested)).toBe("a2019f01ff02a0");
    expect(plutusCbor({ constructor: 0, fields: [new Map([[1, 2]])] })).toBe("d8799fa10102ff");
    expect(plutusCbor(new Map())).toBe("a0");
  });

  it("rejects values that are not plutus data", () => {
    expect(() => plutusCbor(1.5)).toThrow(/safe integers/);
    expect(() => plutusCbor(2 ** 53)).toThrow(/safe integers/);
    expect(() => plutusCbor("text" as unknown as PlutusData)).toThrow(/String not supported/);
    expect(() => plutusCbor({ constructor: -1, fields: [] })).toThrow(/Invalid PlutusData/);
    expect(() =>
      plutusCbor({ constructor: 0, fields: [], extra: 1 } as unknown as PlutusData)
    ).toThrow(/Invalid PlutusData/);
    expect(() => plutusCbor(null as unknown as PlutusData)).toThrow(/Invalid PlutusData/);
  });
});

describe("native scripts", () => {
  it("encodes zero slots and a zero-of-n script", () => {
    expect(toHex(new NativeScriptFactory({ invalidBefore: 0 }).cbor())).toBe("820400");
    expect(toHex(new NativeScriptFactory({ invalidAfter: 0 }).cbor())).toBe("820500");
    expect(toHex(new NativeScriptFactory({ n: 0, k: [] }).cbor())).toBe("83030080");
  });

  it("finds the key hashes of an n-of-k script whatever n is", () => {
    const pubKeyHash = "4eec4012a1a73ae0074028b016d1084cd9d39ac55bff0b52590dd137";
    expect(getPubKeyHashListFromNativeScript({ n: 0, k: [{ pubKeyHash }] })).toEqual([pubKeyHash]);
    expect(getPubKeyHashListFromNativeScript(scenarios.nsNested)).toEqual([
      "4eec4012a1a73ae0074028b016d1084cd9d39ac55bff0b52590dd137",
      "fbe39e3c2b61a864096ebbfb8ed7b7a3fc0a0265c8adafa954920e6f",
      "041c5529bacf35c90dedf1a4c0394b04e2129ed6759adee51782ebdf",
    ]);
  });
});

describe("plutus scripts", () => {
  // hashes the ledger gives the stub script
  const stubHashV2 = "c727443d77df6cff95dca383994f4c3024d03ff56b02ecc22b0f3f65";
  const stubHashV1 = "5f906d7a44879164a341bc1beb8f0b8732e9634efb38395ff83acd9c";

  it("hashes a script with its language", () => {
    const { PlutusScriptV1, PlutusScriptV2 } = types.PlutusScriptType;
    for (const cborHex of [stub.plutusScriptV2S1.cborHex, scenarios.cliV2Hex]) {
      expect(toHex(getPlutusScriptHash({ cborHex, type: PlutusScriptV2 }))).toBe(stubHashV2);
      expect(toHex(getPlutusScriptHash({ cborHex, type: PlutusScriptV1 }))).toBe(stubHashV1);
    }
  });

  it("rejects a cborHex that is not a byte string", () => {
    expect(() => getPlutusScriptBytes("8200")).toThrow(/CBOR byte string/);
    expect(() => getPlutusScriptBytes("4101ff")).toThrow(/CBOR byte string/);
    expect(() => getPlutusScriptBytes("zz")).toThrow(/Invalid hex/);
  });
});

describe("script integrity hash", () => {
  const { languageView } = stub.pParams;

  it("orders language views like the ledger: PlutusV2, PlutusV3, then PlutusV1", () => {
    const views = decode(encodeLanguageViews(languageView, true, true, true)) as Map<
      unknown,
      unknown
    >;
    expect([...views.keys()]).toEqual([1, 2, Uint8Array.of(0)]);
    // PlutusV1's view is the serialized, indefinite list of its cost model
    expect(views.get(1)).toEqual(languageView!.PlutusScriptV2);
    const v1 = [...views.values()][2] as Uint8Array;
    expect(v1[0]).toBe(0x9f);
    expect(decode(v1)).toEqual(languageView!.PlutusScriptV1);
  });

  it("hashes a transaction with datums but no redeemers over an empty redeemer map", () => {
    const datums = [scenarios.datum];
    const witnesses = new Map([[types.WitnessType.PLUTUS_DATA, datums]]) as EncodedWitnesses;
    const expected = blake2b256(
      Uint8Array.from([0xa0, ...encode(datums), 0xa0]) // redeemers | datums | language views
    );
    expect(generateScriptDataHash(undefined, witnesses, false, false, false)).toEqual(expected);
    const none = new Map() as EncodedWitnesses;
    expect(generateScriptDataHash(undefined, none, false, false, false)).toBeUndefined();
  });
});

describe("rationals", () => {
  it("reads decimals as written, in lowest terms", () => {
    expect(toFraction(0.0577)).toEqual({ numerator: 577n, denominator: 10000n });
    expect(toFraction(0.0000721)).toEqual({ numerator: 721n, denominator: 10000000n });
    expect(toFraction("7.21e-5")).toEqual({ numerator: 721n, denominator: 10000000n });
    expect(toFraction(0.5)).toEqual({ numerator: 1n, denominator: 2n });
    expect(toFraction(15)).toEqual({ numerator: 15n, denominator: 1n });
    expect(toFraction(1e21)).toEqual({ numerator: 10n ** 21n, denominator: 1n });
    expect(toFraction("0")).toEqual({ numerator: 0n, denominator: 1n });
  });

  it("keeps fractions as written", () => {
    expect(toFraction("577/10000")).toEqual({ numerator: 577n, denominator: 10000n });
    expect(toFraction([5, 10])).toEqual({ numerator: 5n, denominator: 10n });
    expect(toFraction([2n ** 70n, 3n])).toEqual({ numerator: 2n ** 70n, denominator: 3n });
  });

  it("rejects negative, malformed and non-finite values", () => {
    expect(() => toFraction(-0.5)).toThrow();
    expect(() => toFraction("abc")).toThrow();
    expect(() => toFraction("1/0")).toThrow();
    expect(() => toFraction([1, 0])).toThrow();
    expect(() => toFraction([1.5, 2])).toThrow();
    expect(() => toFraction(Number.NaN)).toThrow();
    expect(() => toFraction("1e99999")).toThrow();
  });
});

describe("governance", () => {
  it("writes protocol parameter rationals as tag 30 and keeps zero values", () => {
    const update = encodeProtocolParamUpdate({
      minFeeA: 44n,
      n: 0,
      collateralPercent: 0,
      pledgeInfluence: [3, 10],
      exUnitPrices: { mem: 0.0577, steps: "721/10000000" },
      poolVotingThreshold: {
        motionNoConfidence: 0.51,
        committeeNormal: "0.51",
        committeeNoConfidence: [51, 100],
        hfInitiation: "51/100",
        securityParamVoting: 0.5,
      },
      refScriptCostByte: 15,
    });
    const decoded = decode(encode(update)) as Map<number, unknown>;
    const ratio = (n: number, d: number) => new CborTag([n, d], 30);
    expect(decoded).toEqual(
      new Map<number, unknown>([
        [0, 44],
        [8, 0],
        [9, ratio(3, 10)],
        [19, [ratio(577, 10000), ratio(721, 10000000)]],
        [23, 0],
        [25, [ratio(51, 100), ratio(51, 100), ratio(51, 100), ratio(51, 100), ratio(1, 2)]],
        [33, ratio(15, 1)],
      ])
    );
  });

  it("encodes every kind of proposal procedure", () => {
    const prevActionId = { txId: fromHex("ee".repeat(32)), index: 2 };
    const policyHash = fromHex("dd".repeat(28));
    const base = {
      deposit: 100000000000n,
      rewardAccount: scenarios.rewardAddress.getBytes(),
      anchor: scenarios.anchor,
    };
    const proposals: Array<ProposalProcedure> = [
      {
        ...base,
        govAction: {
          type: types.GovActionType.PARAM_CHANGE_ACTION,
          action: {
            prevActionId,
            protocolParamUpdate: { maxTxExUnits: { mem: 1, steps: 2 } },
            policyHash,
          },
        },
      },
      {
        ...base,
        govAction: {
          type: types.GovActionType.HF_INIT_ACTION,
          action: { prevActionId: null, protocolVersion: [10, 0] },
        },
      },
      {
        ...base,
        govAction: {
          type: types.GovActionType.TREASURY_WITHDRAW_ACTION,
          action: {
            withdrawals: [{ rewardAccount: scenarios.rewardAddress, amount: 5000000n }],
            policyHash: null,
          },
        },
      },
      {
        ...base,
        govAction: { type: types.GovActionType.NO_CONFIDENCE_ACTION, action: { prevActionId } },
      },
      {
        ...base,
        govAction: {
          type: types.GovActionType.UPDATE_COMMITTEE_ACTION,
          action: {
            prevActionId: null,
            removeColdCreds: [scenarios.coldCred],
            addColdCreds: [{ credential: scenarios.hotCred, epoch: 600 }],
            threshold: 0.67,
          },
        },
      },
      {
        ...base,
        govAction: {
          type: types.GovActionType.NEW_CONSTITUTION_ACTION,
          action: {
            prevActionId,
            constitution: { anchor: scenarios.anchor, scriptHash: policyHash },
          },
        },
      },
      { ...base, govAction: { type: types.GovActionType.INFO_ACTION } },
    ];

    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addInput(scenarios.utxos()[0]);
    proposals.forEach((proposal) => tx.addProposalProcedure(proposal));
    const { body } = decodeTx(tx);

    const encodedAnchor = [scenarios.anchor.url, scenarios.anchor.hash];
    const actionId = [prevActionId.txId, 2];
    const coldCredential = [0, scenarios.coldCred.hash];
    const hotCredential = [0, scenarios.hotCred.hash];
    expect(body.get(20)).toEqual(
      [
        [0, actionId, new Map([[20, [1, 2]]]), policyHash],
        [1, null, [10, 0]],
        [2, new Map([[scenarios.rewardAddress.getBytes(), 5000000]]), null],
        [3, actionId],
        [4, null, [coldCredential], new Map([[hotCredential, 600]]), new CborTag([67, 100], 30)],
        [5, actionId, [encodedAnchor, policyHash]],
        [6],
      ].map((action) => [100000000000, scenarios.rewardAddress.getBytes(), action, encodedAnchor])
    );
    expect(tx.getAdditionalOutputAda()).toBe(7n * 100000000000n);
  });

  it("keeps one vote per voter and action, the latest, without touching the input", () => {
    const actionA = { txId: fromHex("0a".repeat(32)), index: 0 };
    const actionB = { txId: fromHex("0b".repeat(32)), index: 30 };
    const drep = { type: types.VoterType.DREP_KEY, key: scenarios.drepCred };
    const pool = { type: types.VoterType.POOL_KEY, key: scenarios.cred("01".repeat(28)) };
    const first = { voter: drep, votes: [{ govActionId: actionB, vote: 0, anchor: null }] };
    const procedures = [
      first,
      { voter: pool, votes: [{ govActionId: actionA, vote: 2, anchor: null }] },
      {
        voter: drep,
        votes: [
          { govActionId: actionB, vote: 1, anchor: scenarios.anchor },
          { govActionId: actionA, vote: 0, anchor: null },
        ],
      },
    ];
    const encoded = decode(encode(encodeVotingProcedures(procedures))) as Map<unknown, unknown>;
    // voters and actions in canonical order: shorter encoded keys, then bytewise
    expect(encoded).toEqual(
      new Map([
        [
          [2, scenarios.drepCred.hash],
          new Map<unknown, unknown>([
            [
              [actionA.txId, 0],
              [0, null],
            ],
            [
              [actionB.txId, 30],
              [1, [scenarios.anchor.url, scenarios.anchor.hash]],
            ],
          ]),
        ],
        [
          [4, pool.key.hash],
          new Map([
            [
              [actionA.txId, 0],
              [2, null],
            ],
          ]),
        ],
      ])
    );
    expect(first.votes).toHaveLength(1);
  });
});

describe("multi-assets", () => {
  it("sums a repeated asset instead of writing a duplicate key", () => {
    const policyId = "aa".repeat(28);
    const encoded = encodeOutputTokens([
      { policyId, assetName: "01", amount: 5n },
      { policyId: policyId.toUpperCase(), assetName: "01", amount: 7n },
      { policyId, assetName: "02", amount: 1n },
    ]);
    expect(decode(encode(encoded))).toEqual(
      new Map([
        [
          fromHex(policyId),
          new Map([
            [fromHex("01"), 12],
            [fromHex("02"), 1],
          ]),
        ],
      ])
    );
  });

  it("writes the mint in canonical order", () => {
    const encoded = encodeMint([
      {
        policyId: "bb".repeat(28),
        assets: [
          { assetName: "02", amount: 1n },
          { assetName: "01", amount: -1n },
        ],
      },
      {
        policyId: "aa".repeat(28),
        assets: [
          { assetName: "0000", amount: 1n },
          { assetName: "ff", amount: 1n },
        ],
      },
    ]);
    const decoded = decode(encode(encoded)) as Map<Uint8Array, Map<Uint8Array, number>>;
    expect([...decoded.keys()].map(toHex)).toEqual(["aa".repeat(28), "bb".repeat(28)]);
    expect([...decoded.values()].map((assets) => [...assets.keys()].map(toHex))).toEqual([
      ["ff", "0000"],
      ["01", "02"],
    ]);
  });
});

describe("metadata", () => {
  it("limits strings to 64 bytes of UTF-8, not 64 characters", () => {
    expect(() => sanitizeMetadata("é".repeat(32))).not.toThrow();
    expect(() => sanitizeMetadata("é".repeat(33))).toThrow(/length invalid/);
    expect(() => sanitizeMetadata("😀".repeat(17))).toThrow(/length invalid/);
    expect(() => sanitizeMetadata(new Uint8Array(65))).toThrow(/length invalid/);
    expect(() => sanitizeMetadata(new Map([["x".repeat(65), 1]]))).toThrow(/length invalid/);
  });

  it("accepts integers within 64 bits and nothing else", () => {
    expect(sanitizeMetadata(2n ** 64n - 1n)).toBe(2n ** 64n - 1n);
    expect(sanitizeMetadata(-(2n ** 64n))).toBe(-(2n ** 64n));
    expect(() => sanitizeMetadata(2n ** 64n)).toThrow(/out of range/);
    expect(() => sanitizeMetadata(-(2n ** 64n) - 1n)).toThrow(/out of range/);
    for (const value of [1.5, true, null, undefined, new Date(0)]) {
      expect(() => sanitizeMetadata(value)).toThrow();
    }
  });

  it("rejects labels that aren't unsigned integers, and a label used twice", () => {
    for (const label of [-1, 1.5, 2 ** 64, Number.NaN]) {
      expect(() => utils.createAuxiliaryDataCbor({ metadata: [{ label, data: 1 }] })).toThrow(
        /non-negative integer/
      );
    }
    expect(() =>
      utils.createAuxiliaryDataCbor({
        metadata: [
          { label: 674, data: "a" },
          { label: 674, data: "b" },
        ],
      })
    ).toThrow(/Duplicate metadata label 674/);
  });

  it("turns plain objects into maps with text keys", () => {
    expect(sanitizeMetadata({ a: [1, { b: "c" }] })).toEqual(
      new Map([["a", [1, new Map([["b", "c"]])]]])
    );
  });
});

describe("bytes", () => {
  it("reads hex strictly", () => {
    expect(fromHex("ABcd")).toEqual(Uint8Array.of(0xab, 0xcd));
    expect(() => fromHex("abc")).toThrow(/Invalid hex/);
    expect(() => fromHex("0x12")).toThrow(/Invalid hex/);
    expect(() => fromHex("zz")).toThrow(/Invalid hex/);
  });

  it("leaves the input out of hex errors", () => {
    const key = "5f".repeat(32);
    expect(() => fromHex(`${key}0`)).toThrow(/^Invalid hex string: length 65 is odd$/);
    expect(() => fromHex(`${key}\n`)).toThrow(
      /^Invalid hex string: non-hex character "\\n" at index 64$/
    );
    expect(() => fromHex(Uint8Array.of(1, 2) as unknown as string)).toThrow(
      /^Invalid hex string: expected a string, got object$/
    );
  });
});
