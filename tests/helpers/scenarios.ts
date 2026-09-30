import { encode } from "@stricahq/cbors";
import { Transaction, NativeScriptFactory, address as A, types, utils } from "../../src";
import type {
  Credential,
  HashCredential,
  Input,
  NativeScript,
  Output,
  PlutusData,
  PlutusScript,
  Redeemer,
} from "../../src/types";
import * as stub from "../stub";

const { fromHex, toHex } = utils;

const HARDENED = 2147483648;
export const cred = (hash: string, chain = 0, index = 0): HashCredential => ({
  hash: fromHex(hash),
  type: types.HashType.ADDRESS,
  bipPath: { purpose: 1852 + HARDENED, coin: 1815 + HARDENED, account: HARDENED, chain, index },
});
export const scriptCred = (hash: string, plutusScript?: PlutusScript): Credential => ({
  hash: fromHex(hash),
  type: types.HashType.SCRIPT,
  ...(plutusScript ? { plutusScript } : {}),
});

export const stakeCred = cred("45d3dfac74ec966ef4b1ecafb14f6c0b8b0244505788bd8920892940", 2, 0);
export const stakeCred2 = cred("aa3dd3fac74ec966ef4b1ecafb14f6c0b8b0244505788bd892089294", 2, 1);
export const drepCred = cred("11d3dfac74ec966ef4b1ecafb14f6c0b8b0244505788bd8920892940", 3, 0);
export const coldCred = cred("22d3dfac74ec966ef4b1ecafb14f6c0b8b0244505788bd8920892940", 4, 0);
export const hotCred = cred("33d3dfac74ec966ef4b1ecafb14f6c0b8b0244505788bd8920892940", 5, 0);
export const rewardAddress = new A.RewardAddress(types.NetworkId.MAINNET, stakeCred);
export const poolHash = "153806dbcd134ddee69a8c5204e38ac80448f62342f8c23cfe4b7edf";
export const anchor = { url: "https://example.com/anchor.json", hash: fromHex("aa".repeat(32)) };

// the cardano-cli text envelope form of the stub script: wrapped in a second byte string
export const cliV2Hex = toHex(encode(fromHex(stub.plutusScriptV2S1.cborHex)));
export const scriptHashV2 = "a1".repeat(28);
export const scriptHashV1 = "b2".repeat(28);
export const scriptHashV3 = "c3".repeat(28);

export const nsAll: NativeScript = {
  all: [
    { pubKeyHash: "4eec4012a1a73ae0074028b016d1084cd9d39ac55bff0b52590dd137" },
    { invalidAfter: 90000000 },
  ],
};
export const nsNested: NativeScript = {
  any: [
    { pubKeyHash: "4eec4012a1a73ae0074028b016d1084cd9d39ac55bff0b52590dd137" },
    {
      n: 2,
      k: [
        { pubKeyHash: "fbe39e3c2b61a864096ebbfb8ed7b7a3fc0a0265c8adafa954920e6f" },
        { pubKeyHash: "041c5529bacf35c90dedf1a4c0394b04e2129ed6759adee51782ebdf" },
        { invalidBefore: 1000 },
      ],
    },
  ],
};

export const cip19 = [
  "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x",
  "addr1z8phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gten0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs9yc0hh",
  "addr1yx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerkr0vd4msrxnuwnccdxlhdjar77j6lg0wypcc9uar5d2shs2z78ve",
  "addr1x8phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gt7r0vd4msrxnuwnccdxlhdjar77j6lg0wypcc9uar5d2shskhj42g",
  "addr1gx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer5pnz75xxcrzqf96k",
  "addr128phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtupnz75xxcrtw79hu",
  "addr1vx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzers66hrl8",
  "addr1w8phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtcyjy7wx",
  "stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw",
  "stake178phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtcccycj5",
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae",
  "addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz",
  "stake_test1uqehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gssrtvn",
  "Ae2tdPwUPEZFRbyhz3cpfC2CumGzNkFBN2L42rcUc2yjQpEkxDbkPodpMAi",
  "37btjrVyb4KDXBNC4haBVPCrro8AQPHwvCMp3RFhhSVWwfFmZ6wwzSK6JK1hY6wHNmtrpTf1kdbva8TCneM2YsiXT7mrzT21EacHnPpz5YyUdj64na",
];

export const plutusDataCases: Record<string, PlutusData> = {
  int0: 0,
  int23: 23,
  int24: 24,
  int255: 255,
  int256: 256,
  int65536: 65536,
  int2p32: 4294967296,
  intMaxSafe: Number.MAX_SAFE_INTEGER,
  neg1: -1,
  neg24: -24,
  neg25: -25,
  negBig: -4294967297,
  bn64: 18446744073709551615n,
  bnNeg64: -18446744073709551616n,
  bytes0: new Uint8Array(0),
  bytes32: new Uint8Array(32).fill(7),
  bytes64: new Uint8Array(64).fill(9),
  c0: { constructor: 0, fields: [] },
  c6: { constructor: 6, fields: [1] },
  c7: { constructor: 7, fields: [1, 2] },
  c127: { constructor: 127, fields: [] },
  c128: { constructor: 128, fields: [fromHex("ab")] },
  c1000: { constructor: 1000, fields: [] },
  listEmpty: [],
  list: [1, [2, 3], []],
  mapEmpty: new Map(),
  d1: stub.plutusDataD1,
};

export const nativeScriptCases: Record<string, NativeScript> = {
  pkh: { pubKeyHash: "4eec4012a1a73ae0074028b016d1084cd9d39ac55bff0b52590dd137" },
  all: nsAll,
  nested: nsNested,
  before: { invalidBefore: 12345 },
  after: { invalidAfter: 4294967296 },
  anyEmpty: { any: [] },
  allEmpty: { all: [] },
};

export const manyTokens = Array.from({ length: 60 }, (_, i) => ({
  policyId: (i % 3 === 0 ? "aa" : i % 3 === 1 ? "bb" : "cc").repeat(28),
  assetName: toHex(new TextEncoder().encode(`token-${String(i).padStart(3, "0")}`)),
  amount: BigInt(1000 + i),
}));

export const metadata: types.AuxiliaryData = {
  metadata: [
    { label: 674, data: new Map([["msg", ["hello", "world"]]]) },
    { label: 0, data: 42 },
    { label: 1, data: -7 },
    { label: 2, data: fromHex("deadbeef") },
    { label: 3, data: [1, "two", fromHex("03"), new Map([[4, 5]])] },
    { label: 4, data: { name: "typhon", list: [1, 2, 3], nested: { a: "b" } } },
    { label: 5, data: 4294967296 },
    { label: 6, data: "x".repeat(64) },
  ],
};

export const utxos = (): Array<Input> =>
  stub.UTXOs.map((utxo) => ({ ...utxo, tokens: utxo.tokens.map((token) => ({ ...token })) }));

export const collateral = (i: number) => {
  const { txId, index, amount, address } = utxos()[i];
  return { txId, index, amount, address };
};

export const scriptAddress = (hash: string, plutusScript?: PlutusScript) =>
  new A.EnterpriseAddress(types.NetworkId.MAINNET, scriptCred(hash, plutusScript));

export const datum: PlutusData = { constructor: 0, fields: [fromHex("cafe"), 42] };
export const redeemer: Redeemer = {
  plutusData: { constructor: 1, fields: [] },
  exUnits: { mem: 100000, steps: 50000000 },
};

export const payment = (outputs: Array<Output>, extra: (tx: Transaction) => void = () => {}) => {
  const tx = new Transaction({ protocolParams: stub.pParams });
  outputs.forEach((output) => tx.addOutput(output));
  tx.setTTL(3000000);
  extra(tx);
  return tx.prepareTransaction({ inputs: utxos(), changeAddress: stub.changeAddress });
};

const out = (amount: bigint, extra: Partial<Output> = {}): Output => ({
  address: stub.receiverAddress,
  amount,
  tokens: [],
  ...extra,
});

export const transactions: Record<string, () => Transaction> = {
  ada: () => payment([out(5000000n)]),
  ada55: () => payment([out(55000000n)]),
  token: () => payment([out(5000000n, { tokens: [{ ...stub.tokens[0], amount: 10n }] })]),
  allTokens: () => payment([out(3000000n, { tokens: stub.tokens.map((t) => ({ ...t })) })]),
  datumHash: () => payment([out(5000000n, { plutusDataHash: "11".repeat(32) })]),
  inlineDatum: () =>
    payment([out(5000000n, { tokens: [{ ...stub.tokens[0] }], plutusData: stub.plutusDataD1 })]),
  refScriptV2: () => payment([out(9000000n, { plutusScript: stub.plutusScriptV2S1 })]),
  metadata: () => payment([out(5000000n)], (tx) => tx.setAuxiliaryData(metadata)),
  validity: () => payment([out(5000000n)], (tx) => tx.setValidityIntervalStart(1000)),
  manual: () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addInput(utxos()[0]);
    tx.addOutput(out(1000000n));
    tx.addOutput({ address: stub.changeAddress, amount: 48800000n, tokens: [] });
    tx.setFee(200000n);
    tx.setTTL(123456789);
    tx.addWitness({ publicKey: new Uint8Array(32).fill(1), signature: new Uint8Array(64).fill(2) });
    tx.addWitness({ publicKey: new Uint8Array(32).fill(1), signature: new Uint8Array(64).fill(3) });
    tx.addWitness({ publicKey: new Uint8Array(32).fill(4), signature: new Uint8Array(64).fill(5) });
    return tx;
  },
  stakeRegDeleg: () =>
    payment([out(5000000n)], (tx) => {
      tx.addCertificate({ type: 0, cert: { stakeCredential: stakeCred } });
      tx.addCertificate({ type: 2, cert: { stakeCredential: stakeCred, poolHash } });
    }),
  conwayReg: () =>
    payment([out(5000000n)], (tx) => {
      tx.addCertificate({ type: 7, cert: { stakeCredential: stakeCred, deposit: 2000000n } });
      tx.addCertificate({
        type: 9,
        cert: { stakeCredential: stakeCred, dRep: { type: 0, key: drepCred.hash } },
      });
      tx.addCertificate({
        type: 9,
        cert: { stakeCredential: stakeCred2, dRep: { type: 2, key: undefined } },
      });
      tx.addCertificate({
        type: 10,
        cert: {
          stakeCredential: stakeCred2,
          poolKeyHash: fromHex(poolHash),
          dRep: { type: 3, key: undefined },
        },
      });
    }),
  deregWithdraw: () =>
    payment([out(5000000n)], (tx) => {
      tx.addCertificate({ type: 1, cert: { stakeCredential: stakeCred } });
      tx.addCertificate({ type: 8, cert: { stakeCredential: stakeCred2, deposit: 2000000n } });
      tx.addWithdrawal({ rewardAccount: rewardAddress, amount: 1234567n });
    }),
  drepCommitteeEncoding: () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addInput(utxos()[0]);
    tx.addOutput(out(1000000n));
    tx.addCertificate({
      type: 16,
      cert: { dRepCredential: drepCred, deposit: 500000000n, anchor },
    });
    tx.addCertificate({
      type: 16,
      cert: { dRepCredential: stakeCred2, deposit: 500000000n, anchor: null },
    });
    tx.addCertificate({ type: 17, cert: { dRepCredential: drepCred, deposit: 500000000n } });
    tx.addCertificate({ type: 18, cert: { dRepCredential: drepCred, anchor } });
    tx.addCertificate({ type: 18, cert: { dRepCredential: drepCred, anchor: null } });
    tx.addCertificate({ type: 14, cert: { coldCredential: coldCred, hotCredential: hotCred } });
    tx.addCertificate({ type: 15, cert: { coldCredential: coldCred, anchor } });
    tx.addCertificate({
      type: 11,
      cert: { stakeCredential: stakeCred, poolKeyHash: fromHex(poolHash), deposit: 2000000n },
    });
    tx.addCertificate({
      type: 12,
      cert: {
        stakeCredential: stakeCred,
        dRep: { type: 1, key: fromHex(scriptHashV2) },
        deposit: 2000000n,
      },
    });
    tx.addCertificate({
      type: 13,
      cert: {
        stakeCredential: scriptCred(scriptHashV1),
        poolKeyHash: fromHex(poolHash),
        dRep: { type: 2, key: undefined },
        deposit: 2000000n,
      },
    });
    return tx;
  },
  mintNative: () => {
    const policyId = toHex(new NativeScriptFactory(nsAll).policyId());
    return payment(
      [out(2000000n, { tokens: [{ policyId, assetName: "746f6b656e", amount: 100n }] })],
      (tx) =>
        tx.addMint({
          policyId,
          assets: [{ assetName: "746f6b656e", amount: 100n }],
          nativeScript: nsAll,
        })
    );
  },
  burnNative: () => {
    const policyId = toHex(new NativeScriptFactory(nsAll).policyId());
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addInput({
      ...utxos()[0],
      tokens: [{ policyId, assetName: "746f6b656e", amount: 100n }],
    });
    tx.addMint({
      policyId,
      assets: [{ assetName: "746f6b656e", amount: -40n }],
      nativeScript: nsAll,
    });
    tx.addOutput(out(2000000n));
    return tx.prepareTransaction({ inputs: utxos().slice(1), changeAddress: stub.changeAddress });
  },
  plutusV2Spend: () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addInput({
      txId: "ab".repeat(32),
      index: 1,
      amount: 20000000n,
      tokens: [],
      address: scriptAddress(scriptHashV2, {
        cborHex: cliV2Hex,
        type: types.PlutusScriptType.PlutusScriptV2,
      }),
      plutusData: datum,
      redeemer,
    });
    tx.addOutput(out(5000000n));
    tx.addRequiredSigner(cred("4eec4012a1a73ae0074028b016d1084cd9d39ac55bff0b52590dd137"));
    tx.setTTL(3000000);
    return tx.prepareTransaction({
      inputs: utxos(),
      changeAddress: stub.changeAddress,
      collateralInputs: [collateral(3)],
    });
  },
  plutusV1Spend: () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addInput({
      txId: "ab".repeat(32),
      index: 1,
      amount: 20000000n,
      tokens: [],
      address: scriptAddress(scriptHashV1, {
        cborHex: cliV2Hex,
        type: types.PlutusScriptType.PlutusScriptV1,
      }),
      plutusData: datum,
      redeemer,
    });
    tx.addOutput(out(5000000n));
    tx.setTTL(3000000);
    return tx.prepareTransaction({
      inputs: utxos(),
      changeAddress: stub.changeAddress,
      collateralInputs: [collateral(3)],
    });
  },
  plutusV2RefSpend: () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addInput({
      txId: "ab".repeat(32),
      index: 1,
      amount: 20000000n,
      tokens: [],
      address: scriptAddress(scriptHashV2),
      plutusData: datum,
      redeemer,
    });
    tx.addReferenceInput({
      txId: "cd".repeat(32),
      index: 0,
      address: scriptAddress(scriptHashV2, stub.plutusScriptV2S1),
      plutusScript: stub.plutusScriptV2S1,
    });
    tx.addOutput(out(5000000n));
    tx.setTTL(3000000);
    return tx.prepareTransaction({
      inputs: utxos(),
      changeAddress: stub.changeAddress,
      collateralInputs: [collateral(3), collateral(4)],
    });
  },
  vote: () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addVotingProcedure(stub.votingProcedure0);
    tx.addOutput(out(5000000n));
    tx.setTTL(3000000);
    return tx.prepareTransaction({ inputs: utxos(), changeAddress: stub.changeAddress });
  },
  donationTreasury: () =>
    payment([out(5000000n)], (tx) => {
      tx.setDonationAmount(1000000n);
      tx.setTreasuryAmount(2000000n);
    }),
  collateralFields: () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addInput(utxos()[0]);
    tx.addInput(utxos()[1]);
    tx.addOutput(out(5000000n));
    tx.addCollateral(utxos()[2]);
    tx.setCollateralOutput(out(8000000n));
    tx.setTotalCollateral(30000000n);
    return tx;
  },
  splitTokens400: () => {
    const tx = new Transaction({ protocolParams: { ...stub.pParams, maxValueSize: 400 } });
    tx.addOutput(out(3000000n));
    tx.setTTL(3000000);
    return tx.prepareTransaction({
      inputs: [
        {
          txId: "99".repeat(32),
          index: 0,
          amount: 100000000n,
          tokens: manyTokens.map((t) => ({ ...t })),
          address: stub.UTXOs[0].address,
        },
      ],
      changeAddress: stub.changeAddress,
    });
  },
  withdrawOnly: () =>
    payment([out(5000000n)], (tx) =>
      tx.addWithdrawal({ rewardAccount: rewardAddress, amount: 1000000n })
    ),
  byronChange: () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addOutput(out(5000000n));
    tx.setTTL(3000000);
    return tx.prepareTransaction({
      inputs: utxos(),
      changeAddress: utils.getAddressFromString(cip19[14]),
    });
  },
};
