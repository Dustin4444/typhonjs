import { CborTag, decode, decodeAnnotated, encode } from "@stricahq/cbors";
import { describe, expect, it } from "vitest";
import {
  NativeScriptFactory,
  PlutusDataFactory,
  Transaction,
  address as A,
  types,
  utils,
} from "../src";
import type { CollateralInput, Input, Output, PlutusScript, Token } from "../src/types";
import {
  encodeLanguageViews,
  getPlutusScriptBytes,
  getPlutusScriptHash,
} from "../src/utils/encoder";
import { concatBytes } from "../src/utils/bytes";
import { blake2b256, decodeTx } from "./helpers/decode";
import * as scenarios from "./helpers/scenarios";
import * as stub from "./stub";

const { fromHex, toHex } = utils;
const { PlutusScriptV1, PlutusScriptV2 } = types.PlutusScriptType;

const out = (amount: bigint, extra: Partial<Output> = {}): Output => ({
  address: stub.receiverAddress,
  amount,
  tokens: [],
  ...extra,
});

const expectSameTokens = (tokens: Array<Token>, otherTokens: Array<Token>) => {
  const net = new Map<string, bigint>();
  for (const { policyId, assetName, amount } of tokens) {
    const key = `${policyId}.${assetName}`.toLowerCase();
    net.set(key, (net.get(key) ?? 0n) + amount);
  }
  for (const { policyId, assetName, amount } of otherTokens) {
    const key = `${policyId}.${assetName}`.toLowerCase();
    net.set(key, (net.get(key) ?? 0n) - amount);
  }
  expect([...net.values()].every((amount) => amount === 0n)).toBe(true);
};

/**
 * What the ledger checks of a balanced transaction: value is conserved, every output holds
 * its minimum ADA, and the fee covers the size and scripts of the final transaction. When it
 * runs Plutus scripts, what a failing script takes is the collateral less the collateral
 * return: only ADA, at least the collateral percentage of the fee, and the total collateral.
 */
const expectValid = (tx: Transaction) => {
  const { ada: inputAda, tokens: inputTokens } = tx.getInputAmount();
  const { ada: outputAda, tokens: outputTokens } = tx.getOutputAmount();
  expect(inputAda + tx.getAdditionalInputAda()).toBe(
    outputAda + tx.getAdditionalOutputAda() + tx.getFee()
  );
  expectSameTokens(inputTokens, outputTokens);
  const collateralReturn = tx.getCollateralOutput();
  for (const output of [...tx.getOutputs(), ...(collateralReturn ? [collateralReturn] : [])]) {
    expect(output.amount >= tx.calculateMinUtxoAmountBabbage(output)).toBe(true);
    expect(output.tokens.every(({ amount }) => amount > 0n)).toBe(true);
  }
  expect(tx.getFee() >= tx.calculateFee()).toBe(true);
  if (tx.isPlutusTransaction()) {
    expect(tx.getCollaterals().length).toBeGreaterThan(0);
    const taken = tx.getCollateralAmount() - (collateralReturn?.amount ?? 0n);
    const percent = BigInt(tx.protocolParams.collateralPercent!);
    expect(taken * 100n >= tx.getFee() * percent).toBe(true);
    expect(tx.getTotalCollateral() ?? taken).toBe(taken);
    expectSameTokens(
      tx.getCollaterals().flatMap(({ tokens }) => tokens ?? []),
      collateralReturn?.tokens ?? []
    );
  }
};

// the script integrity hash recomputed from the transaction's own witness bytes
const expectedScriptDataHash = (
  tx: Transaction,
  languages: { v1?: boolean; v2?: boolean; v3?: boolean }
) => {
  const witnesses = decodeAnnotated(fromHex(tx.buildTransaction().payload)).at(1)!;
  const redeemers = witnesses.at(5)?.bytes ?? Uint8Array.of(0xa0);
  const datums = witnesses.at(4)?.bytes ?? new Uint8Array(0);
  const views = encodeLanguageViews(
    stub.pParams.languageView,
    !!languages.v1,
    !!languages.v2,
    !!languages.v3
  );
  return toHex(blake2b256(concatBytes(redeemers, datums, views)));
};

const stubHashV2 = toHex(getPlutusScriptHash(stub.plutusScriptV2S1));
const stubHashV3 = toHex(getPlutusScriptHash(stub.plutusScriptV3S1));

const scriptInput = (hash: string, plutusScript?: PlutusScript, extra: Partial<Input> = {}) => ({
  txId: "ab".repeat(32),
  index: 1,
  amount: 20000000n,
  tokens: [],
  address: scenarios.scriptAddress(hash, plutusScript),
  plutusData: scenarios.datum,
  redeemer: scenarios.redeemer,
  ...extra,
});

describe("balancing", () => {
  it("never leaves a change output below minimum ADA", () => {
    // the change of these payments falls in the few thousand lovelace where the change
    // covers minUtxo plus the fee without the change output, but not with it
    for (let amount = 48835000n; amount <= 48840000n; amount += 7n) {
      const tx = new Transaction({ protocolParams: stub.pParams }).paymentTransaction({
        inputs: [stub.UTXOs[0]],
        outputs: [out(amount)],
        changeAddress: stub.changeAddress,
        ttl: 3000000,
      });
      expectValid(tx);
    }
  });

  it("uses the change address to size the change output", () => {
    const byron = utils.getAddressFromString(scenarios.cip19[14]);
    for (let amount = 48700000n; amount <= 48900000n; amount += 997n) {
      const tx = new Transaction({ protocolParams: stub.pParams }).paymentTransaction({
        inputs: [stub.UTXOs[0]],
        outputs: [out(amount)],
        changeAddress: byron,
        ttl: 3000000,
      });
      expectValid(tx);
    }
  });

  it("stays balanced across payments, tokens, datums and scripts", () => {
    for (const [name, build] of Object.entries(scenarios.transactions)) {
      if (["manual", "collateralFields", "drepCommitteeEncoding"].includes(name)) continue;
      expectValid(build());
    }
  });

  it("counts the deposits of registration certificates that carry one", () => {
    const tx = scenarios.payment([out(5000000n)], (t) => {
      t.addCertificate({
        type: types.CertificateType.STAKE_REG_DELEG,
        cert: {
          stakeCredential: scenarios.stakeCred,
          poolKeyHash: fromHex(scenarios.poolHash),
          deposit: 2000000n,
        },
      });
      t.addCertificate({
        type: types.CertificateType.VOTE_REG_DELEG,
        cert: {
          stakeCredential: scenarios.stakeCred2,
          dRep: { type: types.DRepType.ABSTAIN, key: undefined },
          deposit: 2000000n,
        },
      });
      t.addCertificate({
        type: types.CertificateType.STAKE_VOTE_REG_DELEG,
        cert: {
          stakeCredential: scenarios.scriptCred(scenarios.scriptHashV1),
          poolKeyHash: fromHex(scenarios.poolHash),
          dRep: { type: types.DRepType.NO_CONFIDENCE, key: undefined },
          deposit: 2000000n,
        },
      });
      t.addCertificate({
        type: types.CertificateType.DREP_REG,
        cert: { dRepCredential: scenarios.drepCred, deposit: 20000000n, anchor: null },
      });
    });
    expect(tx.getAdditionalOutputAda()).toBe(26000000n);
    expectValid(tx);
  });

  it("counts the refund of a DRep deregistration", () => {
    const tx = scenarios.payment([out(5000000n)], (t) => {
      t.addCertificate({
        type: types.CertificateType.DREP_DE_REG,
        cert: { dRepCredential: scenarios.drepCred, deposit: 500000000n },
      });
    });
    expect(tx.getAdditionalInputAda()).toBe(500000000n);
    expectValid(tx);
    // the refund ends up in the change
    expect(tx.getOutputs()[1].amount).toBe(50000000n + 500000000n - 5000000n - tx.getFee());
  });

  it("matches tokens whatever the case of their hex", () => {
    const token = { ...stub.tokens[0], amount: 10n };
    const adaOnly = scenarios.utxos().map((utxo) => ({ ...utxo, tokens: [] }));
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addOutput(out(2000000n, { tokens: [token] }));
    tx.prepareTransaction({
      inputs: [
        {
          ...adaOnly[0],
          tokens: [{ ...token, policyId: token.policyId.toUpperCase() }],
        },
        ...adaOnly.slice(1),
      ],
      changeAddress: stub.changeAddress,
    });
    expect(tx.getInputs()).toHaveLength(1);
    expect(tx.getOutputs().map(({ tokens }) => tokens.length)).toEqual([1, 0]);
    expectValid(tx);
  });

  it("splits change so that no token set holds a zero amount", () => {
    const token = { policyId: "aa".repeat(28), assetName: "01", amount: 9223372036854775807n };
    expect(utils.getMaximumTokenSets([token], 5000)).toEqual([[token]]);
    expect(() => utils.getMaximumTokenSets([token], 10)).toThrow(/does not fit/);
  });
});

describe("preparing again", () => {
  const spend = (exUnits: { mem: number; steps: number }) => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addInput(
      scriptInput(stubHashV2, stub.plutusScriptV2S1, {
        redeemer: { ...scenarios.redeemer, exUnits },
      })
    );
    // more than the script input holds, so preparing it spends a utxo
    tx.addOutput(out(25000000n));
    return tx;
  };
  const prepare = (tx: Transaction, inputs = scenarios.utxos()) =>
    tx.prepareTransaction({
      inputs,
      changeAddress: stub.changeAddress,
      collateralInputs: [scenarios.collateral(3), scenarios.collateral(4)],
    });
  const evaluated = { mem: 2000000, steps: 5000000 };

  it("balances for the execution units of an evaluation as a new transaction would", () => {
    const expected = prepare(spend(evaluated)).buildTransaction();
    for (const placeholder of [
      { mem: 0, steps: 0 },
      { mem: 14000000, steps: 30000000 },
    ]) {
      // with UTxOs to spare, and with only the one the first call spent
      for (const inputs of [scenarios.utxos(), [scenarios.utxos()[0]]]) {
        const tx = prepare(spend(placeholder), inputs);
        for (const { redeemer } of tx.getRedeemers()) {
          redeemer.exUnits = evaluated;
        }
        prepare(tx, inputs);
        expect(tx.buildTransaction()).toEqual(expected);
        expectValid(tx);
      }
    }
  });

  it("gives the same transaction when nothing changed", () => {
    for (const name of ["ada", "allTokens", "splitTokens400", "deregWithdraw", "plutusV2Spend"]) {
      const tx = scenarios.transactions[name]();
      const built = tx.buildTransaction();
      tx.prepareTransaction({
        inputs: [...tx.getInputs(), ...scenarios.utxos()],
        changeAddress: stub.changeAddress,
        collateralInputs: [scenarios.collateral(3), scenarios.collateral(4)],
      });
      expect(tx.buildTransaction()).toEqual(built);
    }
  });

  it("spends more inputs when what was added since needs them", () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addOutput(out(5000000n));
    tx.prepareTransaction({ inputs: scenarios.utxos(), changeAddress: stub.changeAddress });
    expect(tx.getInputs()).toHaveLength(1);
    tx.addOutput(out(60000000n));
    tx.prepareTransaction({ inputs: scenarios.utxos(), changeAddress: stub.changeAddress });

    const fresh = new Transaction({ protocolParams: stub.pParams });
    fresh.addOutput(out(5000000n));
    fresh.addOutput(out(60000000n));
    fresh.prepareTransaction({ inputs: scenarios.utxos(), changeAddress: stub.changeAddress });
    expect(tx.buildTransaction()).toEqual(fresh.buildTransaction());
    expectValid(tx);
  });

  it("leaves the transaction as it was when it throws", () => {
    const tx = spend(evaluated);
    tx.addOutput(out(500000000n));
    const state = () => ({
      payload: tx.buildTransaction().payload,
      requiredWitnesses: [...tx.getRequiredWitnesses().keys()],
    });
    const before = state();
    expect(() => prepare(tx)).toThrow("Not enough ADA");
    expect(state()).toEqual(before);
  });

  it("leaves the last balanced transaction when balancing again throws", () => {
    const inputs = [scenarios.utxos()[0]];
    const tx = prepare(spend(evaluated), inputs);
    const before = tx.buildTransaction();
    const [{ redeemer }] = tx.getRedeemers();
    redeemer.exUnits = { mem: 2000000000, steps: 0 };
    expect(() => prepare(tx, inputs)).toThrow("Not enough ADA");
    redeemer.exUnits = evaluated;
    expect(tx.buildTransaction()).toEqual(before);
  });
});

describe("inputs", () => {
  it("does not spend an input twice when the utxo list holds one already added", () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    const oneShot = scenarios.utxos()[2];
    tx.addInput(oneShot);
    tx.addOutput(out(5000000n));
    tx.prepareTransaction({ inputs: scenarios.utxos(), changeAddress: stub.changeAddress });
    const keys = tx.getInputs().map(({ txId, index }) => `${txId}#${index}`);
    expect(new Set(keys).size).toBe(keys.length);
    expectValid(tx);
    expect(decodeTx(tx).body.get(0)).toHaveLength(keys.length);
  });

  it("spends utxos only when the inputs already added don't cover the transaction", () => {
    const spend = (amount: bigint) => {
      const tx = new Transaction({ protocolParams: stub.pParams });
      tx.addInput(scriptInput(stubHashV2, stub.plutusScriptV2S1));
      tx.addOutput(out(amount));
      return tx.prepareTransaction({
        inputs: scenarios.utxos(),
        changeAddress: stub.changeAddress,
        collateralInputs: [scenarios.collateral(3)],
      });
    };
    // the script input holds 20 ADA
    const covered = spend(5000000n);
    expect(covered.getInputs()).toHaveLength(1);
    expectValid(covered);
    const short = spend(25000000n);
    expect(short.getInputs()).toHaveLength(2);
    expectValid(short);
  });

  it("refuses to add the same input, reference input, collateral or withdrawal twice", () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    const utxo = scenarios.utxos()[0];
    tx.addInput(utxo);
    expect(() => tx.addInput({ ...utxo, txId: utxo.txId.toUpperCase() })).toThrow(/already added/);
    tx.addReferenceInput({ txId: utxo.txId, index: 5 });
    expect(() => tx.addReferenceInput({ txId: utxo.txId, index: 5 })).toThrow(/already added/);
    tx.addCollateral(scenarios.collateral(3));
    expect(() => tx.addCollateral(scenarios.collateral(3))).toThrow(/already added/);
    tx.addWithdrawal({ rewardAccount: scenarios.rewardAddress, amount: 1n });
    expect(() => tx.addWithdrawal({ rewardAccount: scenarios.rewardAddress, amount: 2n })).toThrow(
      /already added/
    );
  });

  it("refuses to build without an input to spend", () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addWithdrawal({ rewardAccount: scenarios.rewardAddress, amount: 10000000n });
    tx.addOutput(out(5000000n));
    expect(() => tx.prepareTransaction({ inputs: [], changeAddress: stub.changeAddress })).toThrow(
      /No inputs/
    );
  });

  it("orders spend redeemers by input bytes, whatever the case of the tx ids", () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    const redeemer = (mem: number) => ({ ...scenarios.redeemer, exUnits: { mem, steps: 1 } });
    tx.addInput(
      scriptInput(stubHashV2, stub.plutusScriptV2S1, {
        txId: "BB".repeat(32),
        redeemer: redeemer(1),
      })
    );
    tx.addInput(
      scriptInput(stubHashV2, undefined, { txId: "aa".repeat(32), redeemer: redeemer(2) })
    );
    const redeemers = decodeTx(tx).witnesses.get(5) as Array<[number, number, unknown, number[]]>;
    // aa.. sorts before bb.., so the input added second is input 0
    expect(redeemers.map(([tag, index, , [mem]]) => [tag, index, mem])).toEqual([
      [0, 0, 2],
      [0, 1, 1],
    ]);
  });
});

describe("collateral", () => {
  const collateralOf = (amount: bigint, index: number): CollateralInput => ({
    txId: "c0".repeat(32),
    index,
    amount,
    address: stub.UTXOs[2].address,
  });

  // a heavy script, so 150% of the fee is more than a small UTxO holds
  const spendScript = (protocolParams = stub.pParams) => {
    const tx = new Transaction({ protocolParams });
    const exUnits = { mem: 14000000, steps: 10000000000 };
    tx.addInput(
      scriptInput(stubHashV2, stub.plutusScriptV2S1, {
        redeemer: { ...scenarios.redeemer, exUnits },
      })
    );
    tx.addOutput(out(5000000n));
    return tx;
  };
  const tokens = () => stub.tokens.map((token) => ({ ...token }));

  it("adds collateral inputs only until they cover the fee", () => {
    const collaterals = [
      collateralOf(5000000n, 0),
      collateralOf(5000000n, 1),
      collateralOf(1000000n, 2),
    ];
    const tx = spendScript();
    tx.prepareTransaction({
      inputs: scenarios.utxos(),
      changeAddress: stub.changeAddress,
      collateralInputs: collaterals,
    });
    // used from the end of the list: 1 ADA is not enough, 1 + 5 ADA is
    expect(tx.getCollaterals().map(({ index }) => index)).toEqual([2, 1]);
    expect(tx.getCollateralAmount() * 100n >= tx.getFee() * 150n).toBe(true);
    // the caller's list is left as it was
    expect(collaterals).toHaveLength(3);
    expectValid(tx);
  });

  it("puts up no collateral for a transaction without Plutus scripts", () => {
    const protocolParams = { ...stub.pParams, collateralPercent: undefined };
    const tx = new Transaction({ protocolParams });
    tx.addOutput(out(5000000n));
    tx.prepareTransaction({
      inputs: scenarios.utxos(),
      changeAddress: stub.changeAddress,
      collateralInputs: [collateralOf(5000000n, 0), collateralOf(5000000n, 1)],
    });
    expect(tx.getCollaterals()).toHaveLength(0);
    expect(decodeTx(tx).body.has(13)).toBe(false);
    expectValid(tx);
  });

  it("returns what a failing script wouldn't take to the change address", () => {
    const tx = spendScript();
    tx.prepareTransaction({
      inputs: scenarios.utxos(),
      changeAddress: stub.changeAddress,
      collateralInputs: [collateralOf(20000000n, 0)],
    });
    const taken = (tx.getFee() * 150n + 99n) / 100n;
    expect(tx.getTotalCollateral()).toBe(taken);
    expect(tx.getCollateralOutput()).toEqual({
      address: stub.changeAddress,
      amount: 20000000n - taken,
      tokens: [],
    });
    const { body } = decodeTx(tx);
    expect(body.get(16).get(0)).toEqual(stub.changeAddress.getBytes());
    expect(BigInt(body.get(16).get(1))).toBe(20000000n - taken);
    expect(BigInt(body.get(17))).toBe(taken);
    expect(tx.getFee()).toBe(tx.calculateFee());
    expectValid(tx);
  });

  it("puts all of the collateral up when what's left can't pay for a collateral return", () => {
    const tx = spendScript();
    // 3 ADA less 150% of the fee is below minimum ADA
    tx.prepareTransaction({
      inputs: scenarios.utxos(),
      changeAddress: stub.changeAddress,
      collateralInputs: [collateralOf(3000000n, 0)],
    });
    expect(tx.getCollateralOutput()).toBeUndefined();
    expect(decodeTx(tx).body.has(16)).toBe(false);
    expect(tx.getTotalCollateral()).toBe(3000000n);
    expect(tx.getFee()).toBe(tx.calculateFee());
    expectValid(tx);
  });

  it("gives the tokens of the collateral back in the collateral return", () => {
    const tx = spendScript();
    tx.prepareTransaction({
      inputs: scenarios.utxos(),
      changeAddress: stub.changeAddress,
      collateralInputs: [{ ...collateralOf(10000000n, 0), tokens: tokens() }],
    });
    expectSameTokens(tx.getCollateralOutput()!.tokens, stub.tokens);
    expectValid(tx);
  });

  it("adds collateral until what's left pays for the return of its tokens", () => {
    const tx = spendScript();
    // 3.5 ADA covers 150% of the fee, but not that and a collateral return with the tokens
    tx.prepareTransaction({
      inputs: scenarios.utxos(),
      changeAddress: stub.changeAddress,
      collateralInputs: [
        collateralOf(5000000n, 0),
        { ...collateralOf(3500000n, 1), tokens: tokens() },
      ],
    });
    expect(tx.getCollaterals().map(({ index }) => index)).toEqual([1, 0]);
    expectValid(tx);
  });

  it("throws when the collateral can't pay for the return of its tokens", () => {
    const tx = spendScript();
    expect(() =>
      tx.prepareTransaction({
        inputs: scenarios.utxos(),
        changeAddress: stub.changeAddress,
        collateralInputs: [{ ...collateralOf(3500000n, 0), tokens: tokens() }],
      })
    ).toThrow("Not enough collateral supplied");
  });

  it("throws when the tokens of the collateral don't fit in a collateral return", () => {
    const tx = spendScript({ ...stub.pParams, maxValueSize: 100 });
    expect(() =>
      tx.prepareTransaction({
        inputs: [scenarios.utxos()[0]],
        changeAddress: stub.changeAddress,
        collateralInputs: [{ ...collateralOf(10000000n, 0), tokens: tokens() }],
      })
    ).toThrow("don't fit in a collateral return");
  });

  it("covers the whole fee when the leftover ADA goes to the fee", () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    const redeemer = {
      plutusData: { constructor: 0, fields: [] },
      exUnits: { mem: 1000, steps: 100000 },
    };
    tx.addInput(scriptInput(stubHashV2, stub.plutusScriptV2S1, { redeemer }));
    tx.addOutput(out(18760000n));
    // 1.5 ADA covers 150% of the fee the transaction needs, but not of the 1.24 ADA it pays
    tx.prepareTransaction({
      inputs: [],
      changeAddress: stub.changeAddress,
      collateralInputs: [collateralOf(5000000n, 0), collateralOf(1500000n, 1)],
    });
    expect(tx.getOutputs()).toHaveLength(1);
    expect(tx.getFee()).toBe(1240000n);
    expect(tx.getCollaterals().map(({ index }) => index)).toEqual([1, 0]);
    expect(tx.getTotalCollateral()).toBe(1860000n);
    expectValid(tx);
  });
});

describe("certificates", () => {
  it("requires the cold key to sign committee certificates", () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addCertificate({
      type: types.CertificateType.COMMITTEE_AUTH_HOT,
      cert: { coldCredential: scenarios.coldCred, hotCredential: scenarios.hotCred },
    });
    tx.addCertificate({
      type: types.CertificateType.COMMITTEE_RESIGN_COLD,
      cert: { coldCredential: scenarios.coldCred, anchor: null },
    });
    expect([...tx.getRequiredWitnesses().entries()]).toEqual([
      [toHex(scenarios.coldCred.hash), scenarios.coldCred.bipPath],
    ]);
  });

  it("witnesses the native script of a script credential", () => {
    const nativeScript = scenarios.nsAll;
    const stakeCredential = {
      hash: new NativeScriptFactory(nativeScript).policyId(),
      type: types.HashType.SCRIPT,
      nativeScript,
    } as const;
    const rewardAccount = new A.RewardAddress(types.NetworkId.MAINNET, stakeCredential);
    const tx = scenarios.payment([out(5000000n)], (t) => {
      t.addWithdrawal({ rewardAccount, amount: 1000000n });
      t.addCertificate({
        type: types.CertificateType.STAKE_DELEGATION,
        cert: { stakeCredential, poolHash: scenarios.poolHash },
      });
    });
    expect(decodeTx(tx).witnesses.get(1)).toEqual([
      decode(new NativeScriptFactory(nativeScript).cbor()),
    ]);
    // its key hash is counted as a witness when sizing the fee
    expect([...tx.getRequiredNativeScriptWitnesses().keys()]).toEqual([
      "4eec4012a1a73ae0074028b016d1084cd9d39ac55bff0b52590dd137",
    ]);
    expectValid(tx);

    // a stake registration without a deposit runs no script, so its script would be extraneous
    const registration = new Transaction({ protocolParams: stub.pParams });
    registration.addInput(scenarios.utxos()[0]);
    registration.addCertificate({
      type: types.CertificateType.STAKE_REGISTRATION,
      cert: { stakeCredential },
    });
    expect(decodeTx(registration).witnesses.has(1)).toBe(false);
  });
});

describe("mint", () => {
  const policyId = toHex(new NativeScriptFactory(scenarios.nsAll).policyId());

  it("rejects a mint without assets", () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    expect(() => tx.addMint({ policyId, assets: [], nativeScript: scenarios.nsAll })).toThrow(
      /no assets/
    );
  });

  it("rejects an asset whose mint quantities add up to zero", () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addInput(scenarios.utxos()[0]);
    tx.addMint({ policyId, assets: [{ assetName: "01", amount: 5n }] });
    tx.addMint({ policyId, assets: [{ assetName: "01", amount: -5n }] });
    expect(() => tx.buildTransaction()).toThrow(/Mint quantity of .*\.01 is zero/);
  });
});

describe("plutus scripts", () => {
  const spend = (plutusScript: PlutusScript) => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addInput(scriptInput(toHex(getPlutusScriptHash(plutusScript)), plutusScript));
    tx.addOutput(out(5000000n));
    tx.setTTL(3000000);
    return tx.prepareTransaction({
      inputs: scenarios.utxos(),
      changeAddress: stub.changeAddress,
      collateralInputs: [scenarios.collateral(3)],
    });
  };

  it("puts PlutusV3 scripts in the witness set", () => {
    const tx = spend(stub.plutusScriptV3S1);
    const { body, witnesses } = decodeTx(tx);
    expect(witnesses.get(7)).toEqual([getPlutusScriptBytes(stub.plutusScriptV3S1.cborHex)]);
    expect(witnesses.has(6)).toBe(false);
    expect(toHex(body.get(11))).toBe(expectedScriptDataHash(tx, { v3: true }));
    expectValid(tx);
  });

  it("takes a script in either cborHex form", () => {
    const raw = spend(stub.plutusScriptV2S1);
    const cli = spend({ cborHex: scenarios.cliV2Hex, type: PlutusScriptV2 });
    expect(raw.buildTransaction()).toEqual(cli.buildTransaction());
    // the witness is the script as the ledger hashes it
    expect(decodeTx(raw).witnesses.get(6)).toEqual([fromHex(stub.plutusScriptV2S1.cborHex)]);

    const refRaw = scenarios.payment([out(9000000n, { plutusScript: stub.plutusScriptV2S1 })]);
    const refCli = scenarios.payment([
      out(9000000n, { plutusScript: { cborHex: scenarios.cliV2Hex, type: PlutusScriptV2 } }),
    ]);
    expect(refRaw.buildTransaction()).toEqual(refCli.buildTransaction());
  });

  it("hashes the cost models of both languages a transaction runs", () => {
    const tx = scenarios.transactions.plutusV1Spend();
    // the transaction also mints with a PlutusV2 script, found on a reference input's address
    tx.addMint({
      policyId: stubHashV2,
      assets: [{ assetName: "01", amount: 1n }],
      redeemer: scenarios.redeemer,
    });
    tx.addReferenceInput({
      txId: "cd".repeat(32),
      index: 0,
      address: scenarios.scriptAddress(stubHashV2, stub.plutusScriptV2S1),
    });
    const { body } = decodeTx(tx);
    expect(toHex(body.get(11))).toBe(expectedScriptDataHash(tx, { v1: true, v2: true }));
  });

  it("leaves out the script on the address of a reference input the transaction only reads", () => {
    const tx = scenarios.payment([out(5000000n)], (t) =>
      t.addReferenceInput({
        txId: "cd".repeat(32),
        index: 0,
        address: scenarios.scriptAddress(stubHashV2, stub.plutusScriptV2S1),
      })
    );
    expect(tx.isPlutusTransaction()).toBe(false);
    expect(decodeTx(tx).body.has(11)).toBe(false);
    expectValid(tx);
  });

  it("leaves a script out of the witness set when a reference script provides it", () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addInput(scriptInput(stubHashV2, stub.plutusScriptV2S1));
    tx.addReferenceInput({ txId: "cd".repeat(32), index: 0, plutusScript: stub.plutusScriptV2S1 });
    tx.addOutput(out(5000000n));
    const { body, witnesses } = decodeTx(tx);
    expect(witnesses.has(6)).toBe(false);
    expect(toHex(body.get(11))).toBe(expectedScriptDataHash(tx, { v2: true }));

    const nativeScript = scenarios.nsAll;
    const policyId = toHex(new NativeScriptFactory(nativeScript).policyId());
    const mint = new Transaction({ protocolParams: stub.pParams });
    mint.addInput(scenarios.utxos()[0]);
    mint.addMint({ policyId, assets: [{ assetName: "01", amount: 1n }], nativeScript });
    expect(decodeTx(mint).witnesses.get(1)).toHaveLength(1);
    mint.addReferenceInput({ txId: "cd".repeat(32), index: 0, nativeScript });
    expect(decodeTx(mint).witnesses.has(1)).toBe(false);
  });

  it("rejects a redeemer whose Plutus script it can't find", () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    // the script is in a reference input, but the reference input doesn't say which
    tx.addInput(scriptInput(stubHashV2));
    tx.addReferenceInput({ txId: "cd".repeat(32), index: 0 });
    tx.addOutput(out(5000000n));
    expect(() =>
      tx.prepareTransaction({
        inputs: scenarios.utxos(),
        changeAddress: stub.changeAddress,
        collateralInputs: [scenarios.collateral(3)],
      })
    ).toThrow(/Plutus script of a redeemer not found/);
  });

  it("finds the language of a reference script the transaction runs", () => {
    const build = (referenceInput: types.ReferenceInput) => {
      const tx = new Transaction({ protocolParams: stub.pParams });
      tx.addInput(scriptInput(stubHashV2));
      tx.addReferenceInput(referenceInput);
      tx.addOutput(out(5000000n));
      return tx.prepareTransaction({
        inputs: scenarios.utxos(),
        changeAddress: stub.changeAddress,
        collateralInputs: [scenarios.collateral(3)],
      });
    };
    const ref = { txId: "cd".repeat(32), index: 0 };
    // the script alone, as the reference input holds it
    const byHash = build({ ...ref, plutusScript: stub.plutusScriptV2S1 });
    expect(byHash.isPlutusTransaction()).toBe(true);
    expect(toHex(byHash.getScriptIntegrityHash()!)).toBe(
      expectedScriptDataHash(byHash, { v2: true })
    );
    expectValid(byHash);
    // the same transaction as with the script on the reference input's address
    const byAddress = build({
      ...ref,
      address: scenarios.scriptAddress(stubHashV2, stub.plutusScriptV2S1),
      plutusScript: stub.plutusScriptV2S1,
    });
    expect(byHash.buildTransaction()).toEqual(byAddress.buildTransaction());
  });

  it("leaves out the language of a reference script the transaction doesn't run", () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addInput(scriptInput(stubHashV2, stub.plutusScriptV2S1));
    tx.addOutput(out(5000000n));
    const before = toHex(tx.getScriptIntegrityHash()!);
    tx.addReferenceInput({
      txId: "cd".repeat(32),
      index: 0,
      plutusScript: { cborHex: stub.plutusScriptV2S1.cborHex, type: PlutusScriptV1 },
    });
    expect(toHex(tx.getScriptIntegrityHash()!)).toBe(before);
  });

  it("keeps the redeemer of a policy whose script is a reference script", () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addMint({
      policyId: stubHashV3,
      assets: [{ assetName: "01", amount: 1n }],
      redeemer: scenarios.redeemer,
    });
    tx.addReferenceInput({ txId: "cd".repeat(32), index: 0, plutusScript: stub.plutusScriptV3S1 });
    tx.addOutput(
      out(2000000n, { tokens: [{ policyId: stubHashV3, assetName: "01", amount: 1n }] })
    );
    tx.prepareTransaction({
      inputs: scenarios.utxos(),
      changeAddress: stub.changeAddress,
      collateralInputs: [scenarios.collateral(3)],
    });
    const { body, witnesses } = decodeTx(tx);
    expect((witnesses.get(5) as Array<Array<unknown>>).map(([tag, index]) => [tag, index])).toEqual(
      [[1, 0]]
    );
    expect(witnesses.has(7)).toBe(false);
    expect(toHex(body.get(11))).toBe(expectedScriptDataHash(tx, { v3: true }));
    expectValid(tx);
  });

  it("rejects two redeemers for one policy", () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addInput(scenarios.utxos()[0]);
    for (const assetName of ["01", "02"]) {
      tx.addMint({
        policyId: stubHashV2,
        assets: [{ assetName, amount: 1n }],
        plutusScript: stub.plutusScriptV2S1,
        redeemer: scenarios.redeemer,
      });
    }
    expect(() => tx.buildTransaction()).toThrow(/Multiple redeemers/);
  });

  it("charges the same for a price as a decimal, a fraction or a pair", () => {
    const fee = (priceMem: types.Rational, priceSteps: types.Rational) => {
      const tx = new Transaction({ protocolParams: { ...stub.pParams, priceMem, priceSteps } });
      tx.addInput(scriptInput(stubHashV2, stub.plutusScriptV2S1));
      tx.addOutput(out(5000000n));
      return tx.calculateFee();
    };
    const decimal = fee(0.0577, 0.0000721);
    expect(fee("577/10000", "721/10000000")).toBe(decimal);
    expect(fee([577, 10000], [721n, 10000000n])).toBe(decimal);
    expect(fee("0.0577", "7.21e-5")).toBe(decimal);
    // ⌈100000 * 0.0577 + 50000000 * 0.0000721⌉ on top of the size fee
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addInput(scriptInput(stubHashV2, stub.plutusScriptV2S1));
    tx.addOutput(out(5000000n));
    const sizeFee = BigInt(tx.calculateTxSize()) * 44n + 155381n;
    expect(decimal - sizeFee).toBe(9375n);
  });
});

describe("redeemers", () => {
  const redeemer = (mem: number) => ({ ...scenarios.redeemer, exUnits: { mem, steps: 1000 } });
  const v3Credential = scenarios.scriptCred(stubHashV3, stub.plutusScriptV3S1);
  const rewardAccount = (credential: types.Credential) =>
    new A.RewardAddress(types.NetworkId.MAINNET, credential);
  // [tag, index, mem] of each redeemer in the witness set
  const pointers = (tx: Transaction) =>
    (decodeTx(tx).witnesses.get(5) as Array<[number, number, unknown, [number, number]]>).map(
      ([tag, index, , [mem]]) => [tag, index, mem]
    );
  const withInput = () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addInput(scenarios.utxos()[0]);
    return tx;
  };

  it("points a withdrawal redeemer at its reward account, script credentials first", () => {
    const tx = withInput();
    tx.addWithdrawal({ rewardAccount: rewardAccount(scenarios.stakeCred), amount: 1n });
    tx.addWithdrawal({
      rewardAccount: rewardAccount(scenarios.scriptCred("ff".repeat(28))),
      amount: 2n,
      redeemer: redeemer(1),
    });
    tx.addWithdrawal({
      rewardAccount: rewardAccount(v3Credential),
      amount: 3n,
      redeemer: redeemer(2),
    });
    // the withdrawals map is in the order of the reward address bytes, the key credential first
    expect([...decodeTx(tx).body.get(5).values()]).toEqual([1, 3, 2]);
    expect(pointers(tx)).toEqual([
      [3, 0, 2],
      [3, 1, 1],
    ]);
  });

  it("points a certificate redeemer at the certificate's position", () => {
    const tx = withInput();
    tx.addCertificate({
      type: types.CertificateType.STAKE_REGISTRATION,
      cert: { stakeCredential: scenarios.stakeCred },
    });
    tx.addCertificate({
      type: types.CertificateType.STAKE_DELEGATION,
      cert: { stakeCredential: v3Credential, poolHash: scenarios.poolHash },
      redeemer: redeemer(1),
    });
    tx.addCertificate({
      type: types.CertificateType.VOTE_DELEGATION,
      cert: {
        stakeCredential: scenarios.stakeCred,
        dRep: { type: types.DRepType.ABSTAIN, key: undefined },
      },
    });
    tx.addCertificate({
      type: types.CertificateType.DREP_REG,
      cert: { dRepCredential: v3Credential, deposit: 500000000n, anchor: null },
      redeemer: redeemer(2),
    });
    expect(pointers(tx)).toEqual([
      [2, 1, 1],
      [2, 3, 2],
    ]);
    expect(decodeTx(tx).witnesses.get(7)).toHaveLength(1);
  });

  it("points a vote redeemer at its voter: committee, DRep, pool, and a script before a key", () => {
    const vote = {
      govActionId: { txId: fromHex("0a".repeat(32)), index: 0 },
      vote: types.VoteType.YES,
      anchor: null,
    };
    const dRepScript = { type: types.VoterType.DREP_SCRIPT, key: v3Credential };
    const tx = withInput();
    tx.addVotingProcedure({
      voter: { type: types.VoterType.DREP_KEY, key: scenarios.drepCred },
      votes: [vote],
    });
    tx.addVotingProcedure({ voter: dRepScript, votes: [vote], redeemer: redeemer(1) });
    tx.addVotingProcedure({
      voter: { type: types.VoterType.POOL_KEY, key: scenarios.cred("01".repeat(28)) },
      votes: [vote],
    });
    tx.addVotingProcedure({
      voter: { type: types.VoterType.CC_HOT_SCRIPT, key: scenarios.scriptCred("ee".repeat(28)) },
      votes: [vote],
      redeemer: redeemer(2),
    });
    // a voter voting again is still one voter
    tx.addVotingProcedure({
      voter: dRepScript,
      votes: [{ ...vote, govActionId: { ...vote.govActionId, index: 1 } }],
    });
    expect(pointers(tx)).toEqual([
      [4, 0, 2],
      [4, 1, 1],
    ]);
    // the voting procedures map is in the order of the voter bytes, the DRep key first
    const voters = [...decodeTx(tx).body.get(19).keys()] as Array<[number, Uint8Array]>;
    expect(voters.map(([type]) => type)).toEqual([1, 2, 3, 4]);

    tx.addVotingProcedure({ voter: dRepScript, votes: [vote], redeemer: redeemer(3) });
    expect(() => tx.buildTransaction()).toThrow(/Multiple redeemers for voter/);
  });

  it("points a proposal redeemer at the proposal's position", () => {
    const proposal = {
      deposit: 100000000000n,
      rewardAccount: scenarios.rewardAddress.getBytes(),
      anchor: scenarios.anchor,
    };
    const tx = withInput();
    tx.addProposalProcedure({ ...proposal, govAction: { type: types.GovActionType.INFO_ACTION } });
    tx.addProposalProcedure({
      ...proposal,
      govAction: {
        type: types.GovActionType.PARAM_CHANGE_ACTION,
        action: {
          prevActionId: null,
          protocolParamUpdate: { maxTxExUnits: { mem: 1, steps: 2 } },
          policyHash: fromHex(stubHashV3),
        },
      },
      plutusScript: stub.plutusScriptV3S1,
      redeemer: redeemer(1),
    });
    const { body, witnesses } = decodeTx(tx);
    expect(pointers(tx)).toEqual([[5, 1, 1]]);
    expect(witnesses.get(7)).toEqual([getPlutusScriptBytes(stub.plutusScriptV3S1.cborHex)]);
    expect(toHex(body.get(11))).toBe(expectedScriptDataHash(tx, { v3: true }));
    expect(() =>
      tx.addProposalProcedure({
        ...proposal,
        govAction: { type: types.GovActionType.INFO_ACTION },
        redeemer: redeemer(1),
      })
    ).toThrow(/policy hash/);
  });

  it("withdraws with a Plutus script held by a reference input", () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addWithdrawal({
      rewardAccount: rewardAccount(scenarios.scriptCred(stubHashV3)),
      amount: 0n,
      redeemer: scenarios.redeemer,
    });
    tx.addReferenceInput({ txId: "cd".repeat(32), index: 0, plutusScript: stub.plutusScriptV3S1 });
    tx.addOutput(out(5000000n));
    tx.prepareTransaction({
      inputs: scenarios.utxos(),
      changeAddress: stub.changeAddress,
      collateralInputs: [scenarios.collateral(3)],
    });
    const { body, witnesses } = decodeTx(tx);
    expect(pointers(tx)).toEqual([[3, 0, 100000]]);
    expect(witnesses.has(7)).toBe(false);
    expect(toHex(body.get(11))).toBe(expectedScriptDataHash(tx, { v3: true }));
    expect(tx.getCollaterals()).toHaveLength(1);
    expectValid(tx);
  });

  it("charges for the execution units of every redeemer", () => {
    const tx = withInput();
    tx.addWithdrawal({
      rewardAccount: rewardAccount(v3Credential),
      amount: 0n,
      redeemer: { ...scenarios.redeemer, exUnits: { mem: 0, steps: 1000000 } },
    });
    tx.addCertificate({
      type: types.CertificateType.STAKE_DELEGATION,
      cert: { stakeCredential: v3Credential, poolHash: scenarios.poolHash },
      redeemer: { ...scenarios.redeemer, exUnits: { mem: 1000, steps: 0 } },
    });
    const sizeFee = BigInt(tx.calculateTxSize()) * 44n + 155381n;
    // ⌈1000000 * 0.0000721 + 1000 * 0.0577⌉ = ⌈129.8⌉
    expect(tx.calculateFee() - sizeFee).toBe(130n);
  });

  it("lists the redeemers by pointer, to set their execution units from an evaluation", () => {
    const spendRedeemer = { ...scenarios.redeemer };
    const v3Redeemer = { ...scenarios.redeemer };
    const otherRedeemer = { ...scenarios.redeemer };
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addInput(scriptInput(stubHashV3, stub.plutusScriptV3S1, { redeemer: spendRedeemer }));
    tx.addWithdrawal({
      rewardAccount: rewardAccount(scenarios.scriptCred("ff".repeat(28))),
      amount: 0n,
      redeemer: otherRedeemer,
    });
    tx.addWithdrawal({
      rewardAccount: rewardAccount(v3Credential),
      amount: 0n,
      redeemer: v3Redeemer,
    });

    const listed = tx.getRedeemers();
    expect(listed.map(({ tag, index }) => [tag, index])).toEqual([
      [types.RedeemerTag.SPEND, 0],
      [types.RedeemerTag.REWARD, 0],
      [types.RedeemerTag.REWARD, 1],
    ]);
    expect(listed[0].redeemer).toBe(spendRedeemer);
    expect(listed[1].redeemer).toBe(v3Redeemer);
    expect(listed[2].redeemer).toBe(otherRedeemer);

    // execution units keyed by pointer, as an evaluation reports them
    const evaluation = new Map([
      [`${types.RedeemerTag.SPEND}:0`, { mem: 1000000, steps: 1000 }],
      [`${types.RedeemerTag.REWARD}:0`, { mem: 2000000, steps: 1000 }],
      [`${types.RedeemerTag.REWARD}:1`, { mem: 3000000, steps: 1000 }],
    ]);
    for (const { tag, index, redeemer } of listed) {
      redeemer.exUnits = evaluation.get(`${tag}:${index}`)!;
    }
    expect(pointers(tx)).toEqual([
      [0, 0, 1000000],
      [3, 0, 2000000],
      [3, 1, 3000000],
    ]);
    const sizeFee = BigInt(tx.calculateTxSize()) * 44n + 155381n;
    // ⌈6000000 * 0.0577 + 3000 * 0.0000721⌉ = ⌈346200.2163⌉
    expect(tx.calculateFee() - sizeFee).toBe(346201n);
  });

  it("rejects a redeemer on anything that runs no Plutus script", () => {
    const tx = withInput();
    const nativeCredential = {
      hash: new NativeScriptFactory(scenarios.nsAll).policyId(),
      type: types.HashType.SCRIPT,
      nativeScript: scenarios.nsAll,
    } as const;
    expect(() =>
      tx.addWithdrawal({
        rewardAccount: scenarios.rewardAddress,
        amount: 1n,
        redeemer: redeemer(1),
      })
    ).toThrow(/no Plutus script credential/);
    expect(() =>
      tx.addCertificate({
        type: types.CertificateType.STAKE_DELEGATION,
        cert: { stakeCredential: nativeCredential, poolHash: scenarios.poolHash },
        redeemer: redeemer(1),
      })
    ).toThrow(/no Plutus script credential/);
    expect(() =>
      tx.addCertificate({
        type: types.CertificateType.STAKE_REGISTRATION,
        cert: { stakeCredential: v3Credential },
        redeemer: redeemer(1),
      } as types.Certificate)
    ).toThrow(/runs no script/);
    expect(() => tx.addInput({ ...scenarios.utxos()[1], redeemer: redeemer(1) })).toThrow(
      /no Plutus script credential/
    );
    expect(() =>
      tx.addMint({
        policyId: toHex(nativeCredential.hash),
        assets: [{ assetName: "01", amount: 1n }],
        nativeScript: scenarios.nsAll,
        redeemer: redeemer(1),
      })
    ).toThrow(/native script/);
  });
});

describe("reference script fee", () => {
  const withReferenceScript = (plutusScript: PlutusScript | undefined, base: types.Rational) => {
    const tx = new Transaction({
      protocolParams: { ...stub.pParams, minFeeRefScriptCostPerByte: base },
    });
    tx.addInput(scenarios.utxos()[0]);
    tx.addReferenceInput({ txId: "cd".repeat(32), index: 0, plutusScript });
    tx.addOutput(out(5000000n));
    return tx.calculateFee();
  };
  const scriptOfSize = (size: number): PlutusScript => {
    // a flat program starts with its version; the byte string header takes 3 bytes here
    const flat = new Uint8Array(size - 3);
    flat[0] = 1;
    return { cborHex: toHex(encode(flat)), type: PlutusScriptV2 };
  };

  it("prices every 25600 bytes at 1.2 times the tier before", () => {
    const script = scriptOfSize(60000);
    expect(getPlutusScriptBytes(script.cborHex)).toHaveLength(60000);
    // 25600 * 15 + 25600 * 18 + 8800 * 21.6
    expect(withReferenceScript(script, 15) - withReferenceScript(undefined, 15)).toBe(1034880n);
  });

  it("rounds a fractional price down", () => {
    const script = scriptOfSize(1000);
    // 1000 * 44 / 3 = 14666.67
    expect(withReferenceScript(script, [44, 3]) - withReferenceScript(undefined, [44, 3])).toBe(
      14666n
    );
  });
});

describe("protocol parameters", () => {
  const { minFeeA, minFeeB, stakeKeyDeposit, utxoCostPerByte, maxValueSize } = stub.pParams;
  const required: types.ProtocolParams = {
    minFeeA,
    minFeeB,
    stakeKeyDeposit,
    utxoCostPerByte,
    maxValueSize,
  };
  const { stakeCred } = scenarios;

  const prepare = (tx: Transaction, inputs = scenarios.utxos()) =>
    tx.prepareTransaction({
      inputs,
      changeAddress: stub.changeAddress,
      collateralInputs: [scenarios.collateral(3)],
    });

  it("builds payments, staking, votes and native script mints with only the required ones", () => {
    const policyId = toHex(new NativeScriptFactory(scenarios.nsAll).policyId());
    const transactions: Array<(tx: Transaction) => void> = [
      // the change holds the rest of the tokens of a utxo it spends
      (tx) => tx.addOutput(out(3000000n, { tokens: [{ ...stub.tokens[0], amount: 10n }] })),
      (tx) => {
        tx.addCertificate({
          type: types.CertificateType.STAKE_REGISTRATION,
          cert: { stakeCredential: stakeCred },
        });
        tx.addCertificate({
          type: types.CertificateType.STAKE_DELEGATION,
          cert: { stakeCredential: stakeCred, poolHash: scenarios.poolHash },
        });
      },
      (tx) => {
        tx.addCertificate({
          type: types.CertificateType.STAKE_VOTE_REG_DELEG,
          cert: {
            stakeCredential: stakeCred,
            poolKeyHash: fromHex(scenarios.poolHash),
            dRep: { type: types.DRepType.ABSTAIN, key: undefined },
            deposit: 2000000n,
          },
        });
        tx.addWithdrawal({ rewardAccount: scenarios.rewardAddress, amount: 1000000n });
      },
      (tx) => tx.addVotingProcedure(stub.votingProcedure0),
      (tx) => {
        const tokens = [{ policyId, assetName: "01", amount: 1n }];
        tx.addMint({ policyId, assets: tokens, nativeScript: scenarios.nsAll });
        tx.addOutput(out(2000000n, { tokens }));
      },
    ];
    for (const add of transactions) {
      const build = (protocolParams: types.ProtocolParams) => {
        const tx = new Transaction({ protocolParams });
        add(tx);
        return prepare(tx);
      };
      const tx = build(required);
      expect(tx.buildTransaction()).toEqual(build(stub.pParams).buildTransaction());
      expectValid(tx);
    }
  });

  it("names every parameter a Plutus transaction is missing at once", () => {
    const tx = new Transaction({ protocolParams: required });
    tx.addInput(scriptInput(stubHashV2));
    tx.addReferenceInput({ txId: "cd".repeat(32), index: 0, plutusScript: stub.plutusScriptV2S1 });
    tx.addOutput(out(5000000n));
    expect(() => prepare(tx)).toThrow(
      "Missing protocolParams: collateralPercent, priceMem, priceSteps and languageView.PlutusScriptV2 for Plutus scripts; minFeeRefScriptCostPerByte for reference scripts"
    );
  });

  it("names the cost model of each Plutus language the transaction runs", () => {
    const { PlutusScriptV1 } = stub.pParams.languageView!;
    const tx = new Transaction({
      protocolParams: { ...stub.pParams, languageView: { PlutusScriptV1 } },
    });
    tx.addInput(scriptInput(stubHashV2, stub.plutusScriptV2S1));
    tx.addInput(scriptInput(stubHashV3, stub.plutusScriptV3S1, { index: 2 }));
    tx.addOutput(out(5000000n));
    const error =
      "Missing protocolParams: languageView.PlutusScriptV2 and languageView.PlutusScriptV3 for Plutus scripts";
    expect(() => prepare(tx)).toThrow(error);
    expect(() => tx.buildTransaction()).toThrow(error);
  });

  it("names a parameter that a utxo it spends turns out to need", () => {
    const tx = new Transaction({ protocolParams: required });
    tx.addOutput(out(5000000n));
    const [utxo, ...rest] = scenarios.utxos();
    // the first utxo holds a reference script
    expect(() => prepare(tx, [{ ...utxo, nativeScript: scenarios.nsAll }, ...rest])).toThrow(
      "Missing protocolParams: minFeeRefScriptCostPerByte for reference scripts"
    );
    expect(tx.getInputs()).toHaveLength(0);
  });

  it("needs only the parameters a method uses", () => {
    const { languageView } = stub.pParams;
    const tx = new Transaction({ protocolParams: { ...required, languageView } });
    tx.addInput(scriptInput(stubHashV2, stub.plutusScriptV2S1));
    tx.addCollateral(scenarios.collateral(3));
    tx.addOutput(out(18000000n));
    tx.setFee(2000000n);
    // with the fee and collateral set, building needs only the cost model
    expect(() => tx.buildTransaction()).not.toThrow();
    expect(() => tx.calculateFee()).toThrow("Missing protocolParams: priceMem for Plutus scripts");
  });
});

describe("datums", () => {
  it("keeps an inline datum out of the witness set", () => {
    const tx = scenarios.payment([out(5000000n, { plutusData: scenarios.datum })]);
    const { body, witnesses } = decodeTx(tx);
    expect(witnesses.has(4)).toBe(false);
    expect(body.has(11)).toBe(false);
    expectValid(tx);
  });

  it("adds the datum of a datum hash output with a script integrity hash", () => {
    const plutusDataHash = toHex(new PlutusDataFactory(scenarios.datum).plutusDataHash());
    const tx = scenarios.payment([out(5000000n, { plutusDataHash, plutusData: scenarios.datum })]);
    const { body, witnesses } = decodeTx(tx);
    expect(witnesses.get(4)).toHaveLength(1);
    expect(toHex(body.get(11))).toBe(expectedScriptDataHash(tx, {}));
    expectValid(tx);
  });

  it("witnesses a datum of zero", () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addInput(scriptInput(stubHashV2, stub.plutusScriptV2S1, { plutusData: 0 }));
    expect(decodeTx(tx).witnesses.get(4)).toEqual([0]);
  });
});

describe("outputs", () => {
  it("rejects a token without a positive amount", () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    for (const amount of [0n, -1n]) {
      const tokens = [{ ...stub.tokens[0], amount }];
      expect(() => tx.addOutput(out(2000000n, { tokens }))).toThrow(/must be positive/);
      expect(() => tx.setCollateralOutput(out(2000000n, { tokens }))).toThrow(/must be positive/);
    }
  });

  it("writes a native reference script as the script itself", () => {
    const tx = scenarios.payment([out(5000000n, { nativeScript: scenarios.nsNested })]);
    const scriptRef = decodeTx(tx).body.get(1)[0].get(3) as CborTag;
    expect(scriptRef.tag).toBe(24);
    const [language, script] = decode(scriptRef.value) as [number, unknown];
    expect(language).toBe(0);
    expect(encode(script)).toEqual(new NativeScriptFactory(scenarios.nsNested).cbor());
    expectValid(tx);
  });

  it("hashes the body bytes the transaction carries", () => {
    const tx = scenarios.transactions.metadata();
    const { hash, bodyBytes } = decodeTx(tx);
    expect(hash).toBe(toHex(blake2b256(bodyBytes)));
    expect(toHex(tx.getTransactionHash())).toBe(hash);
  });

  it("writes a zero treasury amount, and no donation for zero", () => {
    const tx = new Transaction({ protocolParams: stub.pParams });
    tx.addInput(scenarios.utxos()[0]);
    tx.setTreasuryAmount(0n);
    tx.setDonationAmount(0n);
    const { body } = decodeTx(tx);
    expect(body.get(21)).toBe(0);
    expect(body.has(22)).toBe(false);
  });
});
