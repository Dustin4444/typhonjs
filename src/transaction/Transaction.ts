import { EncodedCbor, encode } from "@stricahq/cbors";

import { getPubKeyHashListFromNativeScript, getUniqueTokens, sortTokens } from "../utils/helpers";

import { CertificateType, GovActionType, HashType, PlutusScriptType, WitnessType } from "../types";
import type {
  CardanoAddress,
  CollateralInput,
  Credential,
  HashCredential,
  Mint,
  NativeScript,
  PlutusData,
  PlutusScript,
  ProtocolParams,
  Redeemer,
  TaggedRedeemer,
  BipPath,
  AuxiliaryData,
  Certificate,
  Input,
  Output,
  Withdrawal,
  Token,
  VKeyWitness,
  ReferenceInput,
  VotingProcedure,
  ProposalProcedure,
} from "../types";
import {
  encodeAuxiliaryData,
  encodeCertificates,
  encodeCollaterals,
  encodeInputs,
  encodeMint,
  encodeOutput,
  encodeOutputs,
  encodeWithdrawals,
  encodeWitnesses,
  encodeNativeScript,
  encodeVotingProcedures,
  encodeProposalProcedures,
  generateScriptDataHash,
  getNativeScriptHash,
  getPlutusScriptBytes,
  getPlutusScriptHash,
  collectRedeemers,
  txInKey,
} from "../utils/encoder";
import { hash32 } from "../utils/crypto";
import { fromHex, toHex } from "../utils/bytes";
import { ceilDiv, toFraction } from "../utils/rational";
import { calculateMinUtxoAmountBabbage } from "../utils/utils";
import transactionBuilder from "./helpers/transactionBuilder";
import { paymentTransaction } from "./helpers/paymentTransaction";
import { missingParamsError, requireParam } from "./helpers/protocolParams";
import type { MissingParam } from "./helpers/protocolParams";
import { TransactionBodyItemType } from "../internal-types";
import type { EncodedWitnesses } from "../internal-types";

// the credential whose witness a certificate needs
const certificateCredential = (certificate: Certificate): Credential => {
  switch (certificate.type) {
    case CertificateType.COMMITTEE_AUTH_HOT:
    case CertificateType.COMMITTEE_RESIGN_COLD:
      return certificate.cert.coldCredential;
    case CertificateType.DREP_REG:
    case CertificateType.DREP_DE_REG:
    case CertificateType.DREP_UPDATE:
      return certificate.cert.dRepCredential;
    default:
      return certificate.cert.stakeCredential;
  }
};

// a stake registration without a deposit is the one certificate the ledger runs no script for
const certificateNeedsScript = (certificate: Certificate): boolean =>
  certificate.type !== CertificateType.STAKE_REGISTRATION;

// the guardrail script a parameter change or treasury withdrawal runs, if it has one
const proposalPolicyHash = ({ govAction }: ProposalProcedure): Uint8Array | null =>
  govAction.type === GovActionType.PARAM_CHANGE_ACTION ||
  govAction.type === GovActionType.TREASURY_WITHDRAW_ACTION
    ? govAction.action.policyHash
    : null;

// the fee while prepareTransaction works it out: no real fee takes more CBOR bytes
const PLACEHOLDER_FEE = 5000000n;

type PlutusLanguages = { v1: boolean; v2: boolean; v3: boolean };

const checkOutputTokens = ({ tokens }: Output) => {
  const token = tokens.find(({ amount }) => amount <= 0n);
  if (token) {
    throw new Error(`Output amount of ${token.policyId}.${token.assetName} must be positive`);
  }
};

// a redeemer is for a Plutus script, which a key hash or a native script credential isn't
const checkRedeemer = (redeemer: Redeemer | undefined, credential: Credential, owner: string) => {
  if (redeemer && (credential.type === HashType.ADDRESS || credential.nativeScript)) {
    throw new Error(`${owner} has a redeemer but no Plutus script credential`);
  }
};

export class Transaction {
  protected _protocolParams: ProtocolParams;

  protected inputs: Array<Input> = [];
  protected referenceInputs: Array<ReferenceInput> = [];
  protected outputs: Array<Output> = [];
  // what the last prepareTransaction added to outputs, which the next one replaces
  protected changeOutputs: Array<Output> = [];
  protected certificates: Array<Certificate> = [];
  protected withdrawals: Array<Withdrawal> = [];
  protected requiredWitnesses: Map<string, BipPath | undefined> = new Map();
  protected requiredNativeScriptWitnesses: Map<string, undefined> = new Map();
  protected fee: bigint = PLACEHOLDER_FEE;
  protected ttl: number | undefined;
  protected witnesses: Array<VKeyWitness> = [];
  protected plutusScriptMap: Map<string, PlutusScriptType> = new Map();
  protected nativeScriptList: Array<NativeScript> = [];
  protected auxiliaryData: AuxiliaryData | undefined;
  protected collaterals: Array<CollateralInput> = [];
  protected collateralOutput: Output | undefined;
  protected totalCollateral: bigint | undefined;
  protected requiredSigners: Map<string, BipPath | undefined> = new Map();
  protected plutusDataList: Array<PlutusData> = [];
  protected _isPlutusV1Transaction = false;
  protected _isPlutusV2Transaction = false;
  protected _isPlutusV3Transaction = false;
  protected mints: Array<Mint> = [];
  protected validityIntervalStart: number | undefined;
  protected votingProcedures: Array<VotingProcedure> = [];
  protected proposalProcedures: Array<ProposalProcedure> = [];
  protected donationAmount: bigint | undefined;
  protected treasuryAmount: bigint | undefined;

  constructor({ protocolParams }: { protocolParams: ProtocolParams }) {
    this._protocolParams = protocolParams;
  }

  get protocolParams() {
    return this._protocolParams;
  }

  getTTL(): number | undefined {
    return this.ttl;
  }

  setTTL(ttl: number): void {
    this.ttl = ttl;
  }

  getValidityIntervalStart(): number | undefined {
    return this.validityIntervalStart;
  }

  setValidityIntervalStart(validityIntervalStart: number): void {
    this.validityIntervalStart = validityIntervalStart;
  }

  protected setPlutusLanguage(type: PlutusScriptType): void {
    if (type === PlutusScriptType.PlutusScriptV1) {
      this._isPlutusV1Transaction = true;
    }
    if (type === PlutusScriptType.PlutusScriptV2) {
      this._isPlutusV2Transaction = true;
    }
    if (type === PlutusScriptType.PlutusScriptV3) {
      this._isPlutusV3Transaction = true;
    }
  }

  protected addRequiredNativeScriptWitnesses(nativeScript: NativeScript): void {
    for (const pkh of getPubKeyHashListFromNativeScript(nativeScript)) {
      this.requiredNativeScriptWitnesses.set(pkh.toLowerCase(), undefined);
    }
  }

  protected addScriptWitness({
    plutusScript,
    nativeScript,
  }: {
    plutusScript?: PlutusScript;
    nativeScript?: NativeScript;
  }): void {
    if (plutusScript) {
      this.plutusScriptMap.set(plutusScript.cborHex, plutusScript.type);
      this.setPlutusLanguage(plutusScript.type);
    } else if (nativeScript) {
      this.addRequiredNativeScriptWitnesses(nativeScript);
      this.nativeScriptList.push(nativeScript);
    }
  }

  hasInput(input: { txId: string; index: number }): boolean {
    const key = txInKey(input.txId, input.index);
    return this.inputs.some((i) => txInKey(i.txId, i.index) === key);
  }

  addInput(input: Input): void {
    if (this.hasInput(input)) {
      throw new Error(`Input ${input.txId}#${input.index} is already added`);
    }
    const credential = input.address.paymentCredential;
    checkRedeemer(input.redeemer, credential, `Input ${input.txId}#${input.index}`);
    if (credential.type === HashType.ADDRESS) {
      this.requiredWitnesses.set(toHex(credential.hash), credential.bipPath);
    } else {
      this.addScriptWitness(credential);
    }
    if (input.plutusData !== undefined) {
      this.plutusDataList.push(input.plutusData);
    }
    this.inputs.push(input);
  }

  /**
   * Adds a reference input. A Plutus script it holds, given as `plutusScript` or on the
   * `address` credential, sets the script's language in the script integrity hash once the
   * transaction runs that script, i.e. spends from, mints with, withdraws with, certifies with
   * or votes with its hash.
   */
  addReferenceInput(input: ReferenceInput): void {
    const key = txInKey(input.txId, input.index);
    if (this.referenceInputs.some((i) => txInKey(i.txId, i.index) === key)) {
      throw new Error(`Reference input ${input.txId}#${input.index} is already added`);
    }
    this.referenceInputs.push(input);
  }

  addRequiredSigner(credential: HashCredential): void {
    this.requiredSigners.set(toHex(credential.hash), credential.bipPath);
  }

  addCollateral(input: CollateralInput): void {
    const key = txInKey(input.txId, input.index);
    if (this.collaterals.some((c) => txInKey(c.txId, c.index) === key)) {
      throw new Error(`Collateral ${input.txId}#${input.index} is already added`);
    }
    if (input.address.paymentCredential.type === HashType.ADDRESS) {
      this.requiredWitnesses.set(
        toHex(input.address.paymentCredential.hash),
        input.address.paymentCredential.bipPath
      );
    }
    this.collaterals.push(input);
  }

  addMint(mint: Mint): void {
    if (mint.assets.length === 0) {
      throw new Error(`Mint of policy ${mint.policyId} has no assets`);
    }
    if (mint.redeemer && mint.nativeScript) {
      throw new Error(`Mint of policy ${mint.policyId} has a redeemer but a native script`);
    }
    this.mints.push(mint);
    this.addScriptWitness(mint);
  }

  /**
   * The method will add a certificate to the transaction to be included in cbor
   * This method will automatically scan and include each unique required witnesses in the map
   * to help sign the transaction
   * @param certificate a certificate to include in the transaction
   */
  addCertificate(certificate: Certificate): void {
    const credential = certificateCredential(certificate);
    const redeemer = "redeemer" in certificate ? certificate.redeemer : undefined;
    if (redeemer && !certificateNeedsScript(certificate)) {
      throw new Error("A stake registration without a deposit runs no script, so no redeemer");
    }
    checkRedeemer(redeemer, credential, `Certificate of type ${certificate.type}`);
    if (credential.type === HashType.ADDRESS) {
      this.requiredWitnesses.set(toHex(credential.hash), credential.bipPath);
    } else if (certificateNeedsScript(certificate)) {
      this.addScriptWitness(credential);
    }
    this.certificates.push(certificate);
  }

  // a datum goes into the witness set only for an output that holds its hash: an inline
  // datum there would be a supplemental datum the ledger does not allow
  protected addOutputDatum(output: Output): void {
    if (output.plutusDataHash && output.plutusData !== undefined) {
      this.plutusDataList.push(output.plutusData);
    }
  }

  addOutput(output: Output): void {
    checkOutputTokens(output);
    const uOutput = output;
    uOutput.tokens = sortTokens(uOutput.tokens);
    this.outputs.push(uOutput);
    this.addOutputDatum(uOutput);
  }

  addWithdrawal(withdrawal: Withdrawal): void {
    const rewardAccount = withdrawal.rewardAccount.getHex();
    if (this.withdrawals.some((w) => w.rewardAccount.getHex() === rewardAccount)) {
      throw new Error(`Withdrawal for ${withdrawal.rewardAccount.getBech32()} is already added`);
    }
    const credential = withdrawal.rewardAccount.stakeCredential;
    checkRedeemer(
      withdrawal.redeemer,
      credential,
      `Withdrawal for ${withdrawal.rewardAccount.getBech32()}`
    );
    if (credential.type === HashType.ADDRESS) {
      this.requiredWitnesses.set(toHex(credential.hash), credential.bipPath);
    } else {
      this.addScriptWitness(credential);
    }
    this.withdrawals.push(withdrawal);
  }

  // add voting procedure to the transaction, used to vote on a governance proposal
  addVotingProcedure(votingProcedure: VotingProcedure): void {
    const credential = votingProcedure.voter.key;
    checkRedeemer(votingProcedure.redeemer, credential, `Voter ${toHex(credential.hash)}`);
    if (credential.type === HashType.ADDRESS) {
      this.requiredWitnesses.set(toHex(credential.hash), credential.bipPath);
    } else {
      this.addScriptWitness(credential);
    }
    this.votingProcedures.push(votingProcedure);
  }

  addProposalProcedure(proposalProcedure: ProposalProcedure): void {
    const { plutusScript, redeemer } = proposalProcedure;
    if ((plutusScript || redeemer) && !proposalPolicyHash(proposalProcedure)) {
      throw new Error("Only a proposal with a policy hash runs a script");
    }
    // a proposal needs no signature, only its policy script if it has one
    this.addScriptWitness({ plutusScript });
    this.proposalProcedures.push(proposalProcedure);
  }

  setCollateralOutput(output: Output | undefined): void {
    if (output === undefined) {
      this.collateralOutput = undefined;
      return;
    }
    checkOutputTokens(output);
    const uOutput = output;
    uOutput.tokens = sortTokens(uOutput.tokens);
    this.collateralOutput = uOutput;
    this.addOutputDatum(uOutput);
  }

  getCollateralOutput(): Output | undefined {
    return this.collateralOutput;
  }

  setTotalCollateral(amount: bigint): void {
    this.totalCollateral = amount;
  }

  getTotalCollateral(): bigint | undefined {
    return this.totalCollateral;
  }

  setDonationAmount(amount: bigint): void {
    this.donationAmount = amount;
  }

  getDonationAmount(): bigint | undefined {
    return this.donationAmount;
  }

  setTreasuryAmount(amount: bigint): void {
    this.treasuryAmount = amount;
  }

  getTreasuryAmount(): bigint | undefined {
    return this.treasuryAmount;
  }

  /**
   * This method will encode the transaction body to be included in the cbor
   */
  protected encodeTransactionBody({
    extraOutputs,
    scriptDataHash,
  }: {
    extraOutputs?: Array<Output>;
    scriptDataHash?: Uint8Array;
  }): unknown {
    const encodedBody = new Map<TransactionBodyItemType, unknown>();
    encodedBody.set(TransactionBodyItemType.INPUTS, encodeInputs(this.inputs));
    let trxOutputs = this.outputs;
    if (extraOutputs && extraOutputs.length > 0) {
      trxOutputs = trxOutputs.concat(extraOutputs);
    }
    encodedBody.set(TransactionBodyItemType.OUTPUTS, encodeOutputs(trxOutputs));
    encodedBody.set(TransactionBodyItemType.FEE, this.fee);
    if (this.ttl !== undefined) {
      encodedBody.set(TransactionBodyItemType.TTL, this.ttl);
    }
    if (this.certificates.length > 0) {
      encodedBody.set(TransactionBodyItemType.CERTIFICATES, encodeCertificates(this.certificates));
    }
    if (this.withdrawals.length > 0) {
      encodedBody.set(TransactionBodyItemType.WITHDRAWALS, encodeWithdrawals(this.withdrawals));
    }
    if (this.auxiliaryData) {
      const auxiliaryDataCbor = encode(encodeAuxiliaryData(this.auxiliaryData));
      encodedBody.set(TransactionBodyItemType.AUXILIARY_DATA_HASH, hash32(auxiliaryDataCbor));
    }
    if (this.validityIntervalStart !== undefined) {
      encodedBody.set(TransactionBodyItemType.VALIDITY_INTERVAL_START, this.validityIntervalStart);
    }
    if (this.mints.length > 0) {
      encodedBody.set(TransactionBodyItemType.MINT, encodeMint(this.mints));
    }
    if (scriptDataHash) {
      encodedBody.set(TransactionBodyItemType.SCRIPT_DATA_HASH, scriptDataHash);
    }
    if (this.collaterals.length > 0) {
      encodedBody.set(
        TransactionBodyItemType.COLLATERAL_INPUTS,
        encodeCollaterals(this.collaterals)
      );
    }
    const requiredSigners = Array.from(this.requiredSigners.keys());
    if (requiredSigners.length > 0) {
      encodedBody.set(
        TransactionBodyItemType.REQUIRED_SIGNERS,
        requiredSigners.map((key) => fromHex(key))
      );
    }
    if (this.collateralOutput) {
      encodedBody.set(
        TransactionBodyItemType.COLLATERAL_OUTPUT,
        encodeOutput(this.collateralOutput)
      );
    }
    if (this.totalCollateral !== undefined) {
      encodedBody.set(TransactionBodyItemType.TOTAL_COLLATERAL, this.totalCollateral);
    }
    if (this.referenceInputs.length > 0) {
      encodedBody.set(TransactionBodyItemType.REFERENCE_INPUTS, encodeInputs(this.referenceInputs));
    }

    if (this.votingProcedures.length > 0) {
      encodedBody.set(
        TransactionBodyItemType.VOTING_PROCEDURES,
        encodeVotingProcedures(this.votingProcedures)
      );
    }

    if (this.proposalProcedures.length > 0) {
      encodedBody.set(
        TransactionBodyItemType.PROPOSAL_PROCEDURES,
        encodeProposalProcedures(this.proposalProcedures)
      );
    }

    // a donation must be positive, zero means none
    if (this.donationAmount) {
      encodedBody.set(TransactionBodyItemType.DONATION_AMOUNT, this.donationAmount);
    }

    if (this.treasuryAmount !== undefined) {
      encodedBody.set(TransactionBodyItemType.TREASURY_AMOUNT, this.treasuryAmount);
    }

    return encodedBody;
  }

  /**
   * The witness set. A script that a spent or reference input holds as a reference script is
   * left out of it, as the ledger rejects a witness it already has as extraneous.
   */
  protected encodeWitnessSet(vKeyWitnesses: Array<VKeyWitness>): EncodedWitnesses {
    const referenceScripts = this.referenceScriptHashes();
    const plutusScripts = new Map(
      [...this.plutusScriptMap].filter(
        ([cborHex, type]) => !referenceScripts.has(toHex(getPlutusScriptHash({ cborHex, type })))
      )
    );
    const nativeScripts = this.nativeScriptList.filter(
      (nativeScript) => !referenceScripts.has(toHex(getNativeScriptHash(nativeScript)))
    );
    return encodeWitnesses(
      vKeyWitnesses,
      this.plutusDataList,
      plutusScripts,
      nativeScripts,
      this.getRedeemers()
    );
  }

  /**
   * Every redeemer with the pointer the ledger identifies it by: what it's for (`tag`) and the
   * index of the item it redeems. The `redeemer` is the object you passed in, so setting its
   * `exUnits`, say from evaluating the transaction, updates the fee and what gets built.
   */
  getRedeemers(): Array<TaggedRedeemer> {
    return collectRedeemers({
      inputs: this.inputs,
      mints: this.mints,
      certificates: this.certificates,
      withdrawals: this.withdrawals,
      votingProcedures: this.votingProcedures,
      proposalProcedures: this.proposalProcedures,
    });
  }

  private referenceScriptHashes(): Set<string> {
    const hashes = new Set<string>();
    for (const { plutusScript, nativeScript } of [...this.inputs, ...this.referenceInputs]) {
      if (plutusScript) {
        hashes.add(toHex(getPlutusScriptHash(plutusScript)));
      }
      if (nativeScript) {
        hashes.add(toHex(getNativeScriptHash(nativeScript)));
      }
    }
    return hashes;
  }

  private neededScriptHashes(): Set<string> {
    const hashes = new Set<string>();
    const add = (credential: Credential) => {
      if (credential.type === HashType.SCRIPT) {
        hashes.add(toHex(credential.hash));
      }
    };
    for (const input of this.inputs) {
      add(input.address.paymentCredential);
    }
    for (const mint of this.mints) {
      hashes.add(mint.policyId.toLowerCase());
    }
    for (const withdrawal of this.withdrawals) {
      add(withdrawal.rewardAccount.stakeCredential);
    }
    for (const certificate of this.certificates) {
      if (certificateNeedsScript(certificate)) {
        add(certificateCredential(certificate));
      }
    }
    for (const votingProcedure of this.votingProcedures) {
      add(votingProcedure.voter.key);
    }
    for (const proposalProcedure of this.proposalProcedures) {
      const policyHash = proposalPolicyHash(proposalProcedure);
      if (policyHash) {
        hashes.add(toHex(policyHash));
      }
    }
    return hashes;
  }

  /**
   * The Plutus languages of the script integrity hash: of the scripts in the witness set, and of
   * the reference scripts the transaction runs, a script on a reference input's address included.
   */
  protected plutusLanguages(): PlutusLanguages {
    const languages = {
      v1: this._isPlutusV1Transaction,
      v2: this._isPlutusV2Transaction,
      v3: this._isPlutusV3Transaction,
    };
    const referenceScripts: Array<{ hash: string; type: PlutusScriptType }> = [];
    for (const { plutusScript } of [...this.referenceInputs, ...this.inputs]) {
      if (plutusScript) {
        referenceScripts.push({
          hash: toHex(getPlutusScriptHash(plutusScript)),
          type: plutusScript.type,
        });
      }
    }
    for (const { address } of this.referenceInputs) {
      const credential = address?.paymentCredential;
      if (credential?.type === HashType.SCRIPT && credential.plutusScript) {
        referenceScripts.push({ hash: toHex(credential.hash), type: credential.plutusScript.type });
      }
    }
    if (referenceScripts.length > 0) {
      const needed = this.neededScriptHashes();
      for (const { hash, type } of referenceScripts) {
        if (needed.has(hash)) {
          if (type === PlutusScriptType.PlutusScriptV1) languages.v1 = true;
          if (type === PlutusScriptType.PlutusScriptV2) languages.v2 = true;
          if (type === PlutusScriptType.PlutusScriptV3) languages.v3 = true;
        }
      }
    }
    return languages;
  }

  // the cost models of the languages the transaction runs that the protocol parameters lack
  private missingLanguageViews({ v1, v2, v3 }: PlutusLanguages): Array<MissingParam> {
    const { languageView } = this._protocolParams;
    const missing: Array<MissingParam> = [];
    if (v1 && !languageView?.PlutusScriptV1) missing.push("languageView.PlutusScriptV1");
    if (v2 && !languageView?.PlutusScriptV2) missing.push("languageView.PlutusScriptV2");
    if (v3 && !languageView?.PlutusScriptV3) missing.push("languageView.PlutusScriptV3");
    return missing;
  }

  private getScriptDataHashFromWitnesses(
    encodedWitnesses: EncodedWitnesses
  ): Uint8Array | undefined {
    const languages = this.plutusLanguages();
    const { v1, v2, v3 } = languages;
    if (!(v1 || v2 || v3) && encodedWitnesses.has(WitnessType.REDEEMER)) {
      throw new Error(
        "Plutus script of a redeemer not found, set plutusScript on the script input or mint, or on the reference input that holds it"
      );
    }
    const missing = this.missingLanguageViews(languages);
    if (missing.length > 0) {
      throw missingParamsError(missing);
    }
    return generateScriptDataHash(this._protocolParams.languageView, encodedWitnesses, v1, v2, v3);
  }

  private transactionFee(size: number): bigint {
    return BigInt(size) * this._protocolParams.minFeeA + this._protocolParams.minFeeB;
  }

  // ⌈mem * priceMem + steps * priceSteps⌉ over the execution units of all redeemers
  private contractFee(): bigint {
    let totalMem = 0n;
    let totalSteps = 0n;

    for (const { redeemer } of this.getRedeemers()) {
      totalMem += BigInt(redeemer.exUnits.mem);
      totalSteps += BigInt(redeemer.exUnits.steps);
    }

    if (totalMem === 0n && totalSteps === 0n) {
      return 0n;
    }

    const priceMem = toFraction(
      requireParam(this._protocolParams, "priceMem"),
      "protocolParams.priceMem"
    );
    const priceSteps = toFraction(
      requireParam(this._protocolParams, "priceSteps"),
      "protocolParams.priceSteps"
    );
    return ceilDiv(
      totalMem * priceMem.numerator * priceSteps.denominator +
        totalSteps * priceSteps.numerator * priceMem.denominator,
      priceMem.denominator * priceSteps.denominator
    );
  }

  // the bytes of the reference scripts that the spent and reference inputs hold
  private referenceScriptSize(): number {
    let size = 0;
    for (const input of [...this.inputs, ...this.referenceInputs]) {
      if (input.nativeScript) {
        size += encode(encodeNativeScript(input.nativeScript)).length;
      }
      if (input.plutusScript) {
        size += getPlutusScriptBytes(input.plutusScript.cborHex).length;
      }
    }
    return size;
  }

  /**
   * The Conway fee for the reference scripts of spent and reference inputs: every 25600 bytes
   * the price per byte grows by a factor of 1.2, and the total is rounded down.
   */
  private calculateRefScriptFee(): bigint {
    // sizeIncrement and multiplier (6/5) are fixed numbers in cardano node
    const sizeIncrement = 25600;

    const totalRefScriptSize = this.referenceScriptSize();
    if (totalRefScriptSize === 0) {
      return 0n;
    }

    const tiers = Math.floor(totalRefScriptSize / sizeIncrement);
    const rest = totalRefScriptSize - tiers * sizeIncrement;
    // the price of tier i is base * 6^i / 5^i: sum them over the common denominator 5^tiers
    let bytePrice = 6n ** BigInt(tiers) * BigInt(rest);
    for (let i = 0; i < tiers; i += 1) {
      bytePrice += 6n ** BigInt(i) * 5n ** BigInt(tiers - i) * BigInt(sizeIncrement);
    }
    const base = toFraction(
      requireParam(this._protocolParams, "minFeeRefScriptCostPerByte"),
      "protocolParams.minFeeRefScriptCostPerByte"
    );
    return (bytePrice * base.numerator) / (base.denominator * 5n ** BigInt(tiers));
  }

  calculateTxSize(extraOutputs?: Array<Output>): number {
    const combinedRequiredWitnesses = new Set([
      ...this.requiredNativeScriptWitnesses.keys(),
      ...this.requiredSigners.keys(),
      ...this.requiredWitnesses.keys(),
    ]);

    // one distinct dummy key per required witness, of the real key and signature sizes
    const dummyWitnesses: Array<VKeyWitness> = [];
    for (let index = 0; index < combinedRequiredWitnesses.size; index += 1) {
      const publicKey = new Uint8Array(32);
      new DataView(publicKey.buffer).setUint32(0, index);
      dummyWitnesses.push({ publicKey, signature: new Uint8Array(64) });
    }
    const encodedWitnesses = this.encodeWitnessSet(dummyWitnesses);
    const scriptDataHash = this.getScriptDataHashFromWitnesses(encodedWitnesses);
    const encodedBody = this.encodeTransactionBody({ extraOutputs, scriptDataHash });
    const transaction = [
      encodedBody,
      encodedWitnesses,
      true,
      this.auxiliaryData ? encodeAuxiliaryData(this.auxiliaryData) : null,
    ];
    return encode(transaction).length;
  }

  calculateFee(extraOutputs?: Array<Output>): bigint {
    const txSize = this.calculateTxSize(extraOutputs);
    const txFee = this.transactionFee(txSize);
    const contractFee = this.contractFee();
    // introduced in Conway era
    const refScriptFee = this.calculateRefScriptFee();
    return txFee + contractFee + refScriptFee;
  }

  setFee(fee: bigint): void {
    this.fee = fee;
  }

  getFee(): bigint {
    return this.fee;
  }

  calculateMinUtxoAmountBabbage(output: Output): bigint {
    return calculateMinUtxoAmountBabbage(output, this._protocolParams.utxoCostPerByte);
  }

  addWitness(witness: VKeyWitness): void {
    this.witnesses.push(witness);
  }

  getTransactionHash(): Uint8Array {
    const encodedWitnesses = this.encodeWitnessSet(this.witnesses);
    const scriptDataHash = this.getScriptDataHashFromWitnesses(encodedWitnesses);
    const encodedBody = this.encodeTransactionBody({ scriptDataHash });
    return hash32(encode(encodedBody));
  }

  getAuxiliaryData(): AuxiliaryData | undefined {
    return this.auxiliaryData;
  }

  getAuxiliaryDataHashHex(): string | undefined {
    if (this.auxiliaryData) {
      const auxiliaryDataCbor = encode(encodeAuxiliaryData(this.auxiliaryData));
      return toHex(hash32(auxiliaryDataCbor));
    }
    return undefined;
  }

  buildTransaction(): { hash: string; payload: string } {
    const encodedWitnesses = this.encodeWitnessSet(this.witnesses);
    const scriptDataHash = this.getScriptDataHashFromWitnesses(encodedWitnesses);
    // the body is encoded once, so the transaction carries exactly the bytes its id hashes
    const trxBodyCbor = encode(this.encodeTransactionBody({ scriptDataHash }));
    const transaction = [
      new EncodedCbor(trxBodyCbor),
      encodedWitnesses,
      true,
      this.auxiliaryData ? encodeAuxiliaryData(this.auxiliaryData) : null,
    ];

    return {
      hash: toHex(hash32(trxBodyCbor)),
      payload: toHex(encode(transaction)),
    };
  }

  getInputs(): Array<Input> {
    return this.inputs;
  }

  getCertificates(): Array<Certificate> {
    return this.certificates;
  }

  getMints(): Array<Mint> {
    const tokens: Array<Token> = [];
    for (const mint of this.mints) {
      for (const asset of mint.assets) {
        tokens.push({
          policyId: mint.policyId,
          assetName: asset.assetName,
          amount: asset.amount,
        });
      }
    }
    const mints = new Map<string, Mint>();
    for (const token of sortTokens(tokens)) {
      const mint = mints.get(token.policyId) ?? { policyId: token.policyId, assets: [] };
      mint.assets.push({ assetName: token.assetName, amount: token.amount });
      mints.set(token.policyId, mint);
    }
    return [...mints.values()];
  }

  getMintTokens(): Array<Token> {
    const tokens = [];
    for (const mint of this.mints) {
      for (const asset of mint.assets) {
        if (asset.amount > 0n) {
          tokens.push({
            policyId: mint.policyId,
            assetName: asset.assetName,
            amount: asset.amount,
          });
        }
      }
    }
    return tokens;
  }

  getBurnTokens(): Array<Token> {
    const tokens = [];
    for (const mint of this.mints) {
      for (const asset of mint.assets) {
        if (asset.amount < 0n) {
          tokens.push({
            policyId: mint.policyId,
            assetName: asset.assetName,
            amount: -asset.amount,
          });
        }
      }
    }
    return tokens;
  }

  getInputAmount(): { ada: bigint; tokens: Array<Token> } {
    let inputTokens: Array<Token> = [];
    let ada = 0n;

    for (const input of this.inputs) {
      inputTokens = inputTokens.concat(input.tokens);
      ada += input.amount;
    }

    inputTokens = inputTokens.concat(this.getMintTokens());

    return {
      ada,
      tokens: getUniqueTokens(inputTokens),
    };
  }

  getCollaterals(): Array<CollateralInput> {
    return this.collaterals;
  }

  getScriptIntegrityHash(): Uint8Array | undefined {
    const encodedWitnesses = this.encodeWitnessSet(this.witnesses);
    return this.getScriptDataHashFromWitnesses(encodedWitnesses);
  }

  getCollateralAmount(): bigint {
    return this.collaterals.reduce((sum, collateral) => sum + collateral.amount, 0n);
  }

  getOutputs(): Array<Output> {
    return this.outputs;
  }

  getOutputAmount(): { ada: bigint; tokens: Array<Token> } {
    let outputTokens: Array<Token> = [];
    let ada = 0n;

    for (const output of this.outputs) {
      outputTokens = outputTokens.concat(output.tokens);
      ada += output.amount;
    }

    outputTokens = outputTokens.concat(this.getBurnTokens());

    return {
      ada,
      tokens: getUniqueTokens(outputTokens),
    };
  }

  /**
   * This method scans the certificates and proposal procedures added in the transaction
   * to calculate additional ADA required for transaction validity.
   * 1. deposits of stake key, stake key with delegation and DRep registrations
   * 2. proposal procedure deposit ADA
   * 3. donation amount
   * @returns additional ADA required for a valid transaction
   */
  getAdditionalOutputAda(): bigint {
    let deposits = 0n;
    for (const certificate of this.certificates) {
      switch (certificate.type) {
        case CertificateType.STAKE_REGISTRATION:
          // legacy stake registration cert, use deposit value from protocol param
          deposits += this._protocolParams.stakeKeyDeposit;
          break;
        case CertificateType.STAKE_KEY_REGISTRATION:
        case CertificateType.STAKE_REG_DELEG:
        case CertificateType.VOTE_REG_DELEG:
        case CertificateType.STAKE_VOTE_REG_DELEG:
        case CertificateType.DREP_REG:
          deposits += certificate.cert.deposit;
          break;
        default:
          break;
      }
    }

    for (const proposalProcedure of this.proposalProcedures) {
      deposits += proposalProcedure.deposit;
    }

    return deposits + (this.donationAmount ?? 0n);
  }

  /**
   * This method scans the certificates added in the transaction to calculate
   * additional ADA available in inputs as part of the deposit refund.
   * Essentially ADA to be considered as additional input due to deposit refunds.
   * @returns additional ADA available as input
   */
  getAdditionalInputAda(): bigint {
    let refunds = 0n;
    for (const certificate of this.certificates) {
      switch (certificate.type) {
        case CertificateType.STAKE_DE_REGISTRATION:
          // legacy stake de registration certificate, use deposit value from protocol params
          refunds += this._protocolParams.stakeKeyDeposit;
          break;
        case CertificateType.STAKE_KEY_DE_REGISTRATION:
        case CertificateType.DREP_DE_REG:
          refunds += certificate.cert.deposit;
          break;
        default:
          break;
      }
    }

    const withdrawalAda = this.withdrawals.reduce((sum, withdrawal) => sum + withdrawal.amount, 0n);

    return refunds + withdrawalAda;
  }

  getWithdrawals(): Array<Withdrawal> {
    return this.withdrawals;
  }

  getRequiredWitnesses(): Map<string, BipPath | undefined> {
    return this.requiredWitnesses;
  }

  getRequiredNativeScriptWitnesses(): Map<string, undefined> {
    return this.requiredNativeScriptWitnesses;
  }

  getRequiredSigners(): Map<string, BipPath | undefined> {
    return this.requiredSigners;
  }

  getVotingProcedures(): Array<VotingProcedure> {
    return this.votingProcedures;
  }

  getProposalProcedures(): Array<ProposalProcedure> {
    return this.proposalProcedures;
  }

  setAuxiliaryData(auxData: AuxiliaryData): void {
    this.auxiliaryData = auxData;
  }

  isPlutusTransaction(): boolean {
    const { v1, v2, v3 } = this.plutusLanguages();
    return v1 || v2 || v3;
  }

  // throws an error naming every optional protocol parameter the transaction needs and lacks
  private checkProtocolParams(): void {
    const params = this._protocolParams;
    const missing: Array<MissingParam> = [];
    const languages = this.plutusLanguages();
    if (languages.v1 || languages.v2 || languages.v3) {
      for (const name of ["collateralPercent", "priceMem", "priceSteps"] as const) {
        if (params[name] == null) {
          missing.push(name);
        }
      }
      missing.push(...this.missingLanguageViews(languages));
    }
    if (params.minFeeRefScriptCostPerByte == null && this.referenceScriptSize() > 0) {
      missing.push("minFeeRefScriptCostPerByte");
    }
    if (missing.length > 0) {
      throw missingParamsError(missing);
    }
  }

  /**
   * Function to prepare transaction automatically
   * There are other helper methods for preparing transactions that use this method
   * This method should be used when you know what you are doing
   * sets required inputs,
   * fees,
   * change etc
   * resulting transaction is the final tx that can be built for signing
   *
   * A transaction that runs Plutus scripts also gets as many of `collateralInputs` as it takes
   * to cover the fee. A collateral return sends what a failing script wouldn't take back to the
   * change address, and the total collateral is set to what it would take. Both replace any
   * collateral return or total collateral set before.
   *
   * Call it again after changing the transaction, such as setting execution units from an
   * evaluation, and it balances the transaction again. It replaces the change outputs it added
   * before and keeps the inputs and collateral it spent, adding more if the fee needs them.
   * When it throws, the transaction is left as it was.
   *
   * When the transaction needs optional protocol parameters that are missing, such as the
   * Plutus ones, it throws an error naming all of them.
   */
  prepareTransaction({
    inputs,
    changeAddress,
    collateralInputs = [],
  }: {
    inputs: Array<Input>;
    changeAddress: CardanoAddress;
    collateralInputs?: Array<CollateralInput>;
  }): Transaction {
    this.checkProtocolParams();
    // the builder adds to the arrays and maps in place, so they're copied to put back on failure
    const saved = Object.fromEntries(
      Object.entries(this).map(([key, value]) => [
        key,
        Array.isArray(value) ? [...value] : value instanceof Map ? new Map(value) : value,
      ])
    );
    try {
      this.outputs = this.outputs.filter((output) => !this.changeOutputs.includes(output));
      this.fee = PLACEHOLDER_FEE;
      this.changeOutputs = transactionBuilder({
        transaction: this,
        inputs,
        changeAddress,
        collateralInputs,
      });
    } catch (error) {
      Object.assign(this, saved);
      throw error;
    }
    return this;
  }

  /**
   * Function for a simple send ADA transaction
   * Provide necessary outputs, and available inputs, returns a final tx
   */
  paymentTransaction({
    inputs,
    outputs,
    changeAddress,
    auxiliaryData,
    ttl,
  }: {
    inputs: Array<Input>;
    outputs: Array<Output>;
    changeAddress: CardanoAddress;
    auxiliaryData?: AuxiliaryData;
    ttl: number;
  }) {
    return paymentTransaction({
      inputs,
      outputs,
      changeAddress,
      auxiliaryData,
      ttl,
      protocolParams: this.protocolParams,
    });
  }
}

export default Transaction;
