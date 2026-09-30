import type BaseAddress from "./address/BaseAddress";
import type ByronAddress from "./address/ByronAddress";
import type EnterpriseAddress from "./address/EnterpriseAddress";
import type PointerAddress from "./address/PointerAddress";
import type RewardAddress from "./address/RewardAddress";

export type ShelleyAddress = BaseAddress | EnterpriseAddress | PointerAddress;

export type CardanoAddress = ShelleyAddress | ByronAddress | RewardAddress;

export type BipPath = {
  purpose: number;
  coin: number;
  account: number;
  chain: number;
  index: number;
};

export enum HashType {
  ADDRESS = 0,
  SCRIPT = 1,
}

export enum PlutusScriptType {
  PlutusScriptV1 = "PlutusScriptV1",
  PlutusScriptV2 = "PlutusScriptV2",
  PlutusScriptV3 = "PlutusScriptV3",
}

export enum VoteType {
  NO = 0,
  YES = 1,
  ABSTAIN = 2,
}

export enum VoterType {
  CC_HOT_KEY = 0,
  CC_HOT_SCRIPT = 1,
  DREP_KEY = 2,
  DREP_SCRIPT = 3,
  POOL_KEY = 4,
}

export enum GovActionType {
  PARAM_CHANGE_ACTION = 0,
  HF_INIT_ACTION = 1,
  TREASURY_WITHDRAW_ACTION = 2,
  NO_CONFIDENCE_ACTION = 3,
  UPDATE_COMMITTEE_ACTION = 4,
  NEW_CONSTITUTION_ACTION = 5,
  INFO_ACTION = 6,
}

/**
 * An exact non-negative rational, the way the chain stores prices and thresholds (tag 30).
 *
 * - a decimal `number` or string: `0.0577`, `"0.0577"`, `"7.21e-5"`, read as written and
 *   converted to lowest terms
 * - a fraction string: `"577/10000"`
 * - a `[numerator, denominator]` pair
 */
export type Rational = number | string | [number | bigint, number | bigint];

export type HashCredential = {
  hash: Uint8Array;
  type: HashType.ADDRESS;
  bipPath?: BipPath;
};

export type NativeScriptPubKeyHash = {
  pubKeyHash: string;
};

export type NativeScriptAll = {
  all: Array<NativeScript>;
};

export type NativeScriptAny = {
  any: Array<NativeScript>;
};

export type NativeScriptNOfK = {
  n: number;
  k: Array<NativeScript>;
};

export type NativeScriptInvalidBefore = {
  invalidBefore: number;
};

export type NativeScriptInvalidAfter = {
  invalidAfter: number;
};

export type NativeScript =
  | NativeScriptPubKeyHash
  | NativeScriptNOfK
  | NativeScriptInvalidBefore
  | NativeScriptInvalidAfter
  | NativeScriptAll
  | NativeScriptAny;

export type CLINativeScriptPubKeyHash = {
  type: "sig";
  keyHash: string;
};

export type CLINativeScriptAll = {
  type: "all";
  scripts: Array<CLINativeScript>;
};

export type CLINativeScriptAny = {
  type: "any";
  scripts: Array<CLINativeScript>;
};

export type CLINativeScriptAtLeast = {
  type: "atLeast";
  required: number;
  scripts: Array<CLINativeScript>;
};

export type CLINativeScriptBefore = {
  type: "before";
  slot: number;
};

export type CLINativeScriptAfter = {
  type: "after";
  slot: number;
};

export type CLINativeScript =
  | CLINativeScriptPubKeyHash
  | CLINativeScriptAtLeast
  | CLINativeScriptBefore
  | CLINativeScriptAfter
  | CLINativeScriptAll
  | CLINativeScriptAny;

/**
 * A Plutus script. `cborHex` is either the `cborHex` of a cardano-cli text envelope (the
 * script bytes wrapped in a CBOR byte string twice) or the script bytes as the ledger hashes
 * them (wrapped once); both are accepted everywhere a script is used.
 */
export type PlutusScript = {
  cborHex: string;
  type: PlutusScriptType;
};

export type ScriptCredential = {
  hash: Uint8Array;
  type: HashType.SCRIPT;
  plutusScript?: PlutusScript;
  nativeScript?: NativeScript;
};

export type Credential = HashCredential | ScriptCredential;

export type StakeCredential = Credential;
export type DRepCredential = Credential;
export type CommitteeHotCredential = Credential;
export type CommitteeColdCredential = Credential;

export enum CertificateType {
  STAKE_REGISTRATION = 0,
  STAKE_DE_REGISTRATION = 1,
  STAKE_DELEGATION = 2,
  STAKE_KEY_REGISTRATION = 7,
  STAKE_KEY_DE_REGISTRATION = 8,
  VOTE_DELEGATION = 9,
  STAKE_VOTE_DELEG = 10,
  STAKE_REG_DELEG = 11,
  VOTE_REG_DELEG = 12,
  STAKE_VOTE_REG_DELEG = 13,
  COMMITTEE_AUTH_HOT = 14,
  COMMITTEE_RESIGN_COLD = 15,
  DREP_REG = 16,
  DREP_DE_REG = 17,
  DREP_UPDATE = 18,
}

export enum WitnessType {
  V_KEY_WITNESS = 0,
  NATIVE_SCRIPT = 1,
  PLUTUS_SCRIPT_V1 = 3,
  PLUTUS_DATA = 4,
  REDEEMER = 5,
  PLUTUS_SCRIPT_V2 = 6,
  PLUTUS_SCRIPT_V3 = 7,
}

export enum NetworkId {
  MAINNET = 1,
  TESTNET = 0,
}

export type Token = {
  policyId: string;
  assetName: string;
  amount: bigint;
};

export type Input = {
  txId: string;
  index: number;
  amount: bigint;
  tokens: Array<Token>;
  address: ShelleyAddress;
  plutusData?: PlutusData;
  redeemer?: Redeemer;
  plutusScript?: PlutusScript;
  nativeScript?: NativeScript;
};

export type ReferenceInput = {
  txId: string;
  index: number;
  amount?: bigint;
  tokens?: Array<Token>;
  address?: ShelleyAddress;
  plutusData?: PlutusData;
  plutusScript?: PlutusScript;
  nativeScript?: NativeScript;
};

export type Asset = {
  assetName: string;
  amount: bigint;
};

export type Mint = {
  policyId: string;
  assets: Array<Asset>;
  nativeScript?: NativeScript;
  plutusScript?: PlutusScript;
  redeemer?: Redeemer;
};

/**
 * A UTxO put up as collateral. Set `tokens` if it holds any, so they go back in the
 * collateral return.
 */
export type CollateralInput = {
  txId: string;
  index: number;
  amount: bigint;
  tokens?: Array<Token>;
  address: ShelleyAddress;
};

export type Output = {
  amount: bigint;
  address: CardanoAddress;
  tokens: Array<Token>;
  plutusData?: PlutusData;
  plutusDataHash?: string;
  plutusScript?: PlutusScript;
  nativeScript?: NativeScript;
};

export enum DRepType {
  ADDRESS = 0,
  SCRIPT = 1,
  ABSTAIN = 2,
  NO_CONFIDENCE = 3,
}

export type DRep = {
  type: DRepType;
  key: Uint8Array | undefined;
};

export type Anchor = {
  url: string;
  hash: Uint8Array;
};

export type StakeRegistrationCertificate = {
  type: CertificateType.STAKE_REGISTRATION;
  cert: {
    stakeCredential: StakeCredential;
  };
};

export type StakeDeRegistrationCertificate = {
  type: CertificateType.STAKE_DE_REGISTRATION;
  cert: {
    stakeCredential: StakeCredential;
  };
  redeemer?: Redeemer;
};

export type StakeDelegationCertificate = {
  type: CertificateType.STAKE_DELEGATION;
  cert: {
    stakeCredential: StakeCredential;
    poolHash: string;
  };
  redeemer?: Redeemer;
};

export type StakeKeyRegistrationCertificate = {
  type: CertificateType.STAKE_KEY_REGISTRATION;
  cert: {
    stakeCredential: StakeCredential;
    deposit: bigint;
  };
  redeemer?: Redeemer;
};

export type StakeKeyDeRegistrationCertificate = {
  type: CertificateType.STAKE_KEY_DE_REGISTRATION;
  cert: {
    stakeCredential: StakeCredential;
    deposit: bigint;
  };
  redeemer?: Redeemer;
};

export type VoteDelegationCertificate = {
  type: CertificateType.VOTE_DELEGATION;
  cert: {
    stakeCredential: StakeCredential;
    dRep: DRep;
  };
  redeemer?: Redeemer;
};

export type StakeVoteDelegationCertificate = {
  type: CertificateType.STAKE_VOTE_DELEG;
  cert: {
    stakeCredential: StakeCredential;
    poolKeyHash: Uint8Array;
    dRep: DRep;
  };
  redeemer?: Redeemer;
};

export type StakeRegDelegationCertificate = {
  type: CertificateType.STAKE_REG_DELEG;
  cert: {
    stakeCredential: StakeCredential;
    poolKeyHash: Uint8Array;
    deposit: bigint;
  };
  redeemer?: Redeemer;
};

export type VoteRegDelegationCertificate = {
  type: CertificateType.VOTE_REG_DELEG;
  cert: {
    stakeCredential: StakeCredential;
    dRep: DRep;
    deposit: bigint;
  };
  redeemer?: Redeemer;
};

export type StakeVoteRegDelegationCertificate = {
  type: CertificateType.STAKE_VOTE_REG_DELEG;
  cert: {
    stakeCredential: StakeCredential;
    poolKeyHash: Uint8Array;
    dRep: DRep;
    deposit: bigint;
  };
  redeemer?: Redeemer;
};

export type CommitteeAuthHotCertificate = {
  type: CertificateType.COMMITTEE_AUTH_HOT;
  cert: {
    coldCredential: CommitteeColdCredential;
    hotCredential: CommitteeHotCredential;
  };
  redeemer?: Redeemer;
};

export type CommitteeResignColdCertificate = {
  type: CertificateType.COMMITTEE_RESIGN_COLD;
  cert: {
    coldCredential: CommitteeColdCredential;
    anchor: Anchor | null;
  };
  redeemer?: Redeemer;
};

export type DRepRegCertificate = {
  type: CertificateType.DREP_REG;
  cert: {
    dRepCredential: DRepCredential;
    deposit: bigint;
    anchor: Anchor | null;
  };
  redeemer?: Redeemer;
};

export type DRepDeRegCertificate = {
  type: CertificateType.DREP_DE_REG;
  cert: {
    dRepCredential: DRepCredential;
    deposit: bigint;
  };
  redeemer?: Redeemer;
};

export type DRepUpdateCertificate = {
  type: CertificateType.DREP_UPDATE;
  cert: {
    dRepCredential: DRepCredential;
    anchor: Anchor | null;
  };
  redeemer?: Redeemer;
};

export type Withdrawal = {
  rewardAccount: RewardAddress;
  amount: bigint;
  redeemer?: Redeemer;
};

export type Certificate =
  | StakeRegistrationCertificate
  | StakeDeRegistrationCertificate
  | StakeDelegationCertificate
  | StakeKeyRegistrationCertificate
  | StakeKeyDeRegistrationCertificate
  | VoteDelegationCertificate
  | StakeVoteDelegationCertificate
  | StakeRegDelegationCertificate
  | VoteRegDelegationCertificate
  | StakeVoteRegDelegationCertificate
  | CommitteeAuthHotCertificate
  | CommitteeResignColdCertificate
  | DRepRegCertificate
  | DRepDeRegCertificate
  | DRepUpdateCertificate;

export type VKeyWitness = {
  publicKey: Uint8Array;
  signature: Uint8Array;
};

/**
 * Metadata value. Strings and byte strings hold at most 64 bytes (UTF-8 for strings), and
 * integers fit in -(2^64 - 1) to 2^64 - 1. A plain object is written as a map with text keys.
 */
export type MetaDatum =
  | Map<MetaDatum, MetaDatum>
  | Array<MetaDatum>
  | number
  | bigint
  | Uint8Array
  | string
  | { [key: string]: MetaDatum };

export type Metadata = {
  label: number;
  data: MetaDatum;
};

export type AuxiliaryData = {
  metadata: Array<Metadata>;
  // TODO: nativeScript;
  // TODO: plutusScript;
};

/**
 * Plutus data. A `number` must be a safe integer, use a `bigint` beyond ±2^53. Byte strings
 * longer than 64 bytes and integers beyond 64 bits are written in the chunked form the
 * ledger requires.
 */
export type PlutusData =
  | number
  | bigint
  | Uint8Array
  | PlutusDataConstructor
  | Array<PlutusData>
  | Map<PlutusData, PlutusData>;

export type PlutusDataConstructor = {
  constructor: number;
  fields: Array<PlutusData>;
};

export type ExUnits = {
  mem: number;
  steps: number;
};

/**
 * What a Plutus script runs with. It goes on whatever runs the script: a script input, a mint,
 * a certificate, withdrawal or voting procedure of a Plutus script credential, or a proposal
 * procedure with a policy hash.
 */
export type Redeemer = {
  plutusData: PlutusData;
  exUnits: ExUnits;
};

/**
 * What a redeemer is for. With its index it points at the input, mint policy, certificate,
 * withdrawal, voter or proposal whose script it runs.
 */
export enum RedeemerTag {
  SPEND = 0,
  MINT = 1,
  CERT = 2,
  REWARD = 3,
  VOTING = 4,
  PROPOSING = 5,
}

/**
 * A redeemer with its pointer: what it's for, and the index of the item it redeems.
 */
export type TaggedRedeemer = {
  tag: RedeemerTag;
  index: number;
  redeemer: Redeemer;
};

export type LanguageView = {
  PlutusScriptV1?: Array<number>;
  PlutusScriptV2?: Array<number>;
  PlutusScriptV3?: Array<number>;
};

/**
 * The protocol parameters a transaction is built with. Payments and staking need only the
 * required ones. The others are needed only by the transactions that use them, and building one
 * without them throws an error that names each one missing:
 *
 * - `collateralPercent`, `priceMem`, `priceSteps` and the `languageView` of each Plutus
 *   language it runs, for Plutus scripts
 * - `minFeeRefScriptCostPerByte`, for spending or referencing a UTxO that holds a reference
 *   script
 *
 * When `maxTxSize` is given, `prepareTransaction` throws for a transaction bigger than it.
 */
export type ProtocolParams = {
  minFeeA: bigint;
  minFeeB: bigint;
  stakeKeyDeposit: bigint;
  utxoCostPerByte: bigint;
  maxValueSize: number;
  maxTxSize?: number;
  minFeeRefScriptCostPerByte?: Rational;
  collateralPercent?: number;
  priceMem?: Rational;
  priceSteps?: Rational;
  languageView?: LanguageView;
};

export type CostMdls = {
  plutusV1?: Array<number>;
  plutusV2?: Array<number>;
  plutusV3?: Array<number>;
};

export type ProtocolParamUpdate = {
  minFeeA?: bigint;
  minFeeB?: bigint;
  maxBlockBodySize?: number;
  maxTransactionSize?: number;
  maxBlockHeaderSize?: number;
  stakeKeyDeposit?: bigint;
  poolDeposit?: bigint;
  poolRetireMaxEpoch?: number;
  n?: number;
  pledgeInfluence?: Rational;
  expansionRate?: Rational;
  treasuryGrowthRate?: Rational;
  minPoolCost?: bigint;
  adaPerUtxoByte?: bigint;
  costMdls?: CostMdls;
  exUnitPrices?: {
    mem: Rational;
    steps: Rational;
  };
  maxTxExUnits?: {
    mem: number;
    steps: number;
  };
  maxBlockExUnits?: {
    mem: number;
    steps: number;
  };
  maxValueSize?: number;
  collateralPercent?: number;
  maxCollateralInputs?: number;
  poolVotingThreshold?: {
    motionNoConfidence: Rational;
    committeeNormal: Rational;
    committeeNoConfidence: Rational;
    hfInitiation: Rational;
    securityParamVoting: Rational;
  };
  dRepVotingThreshold?: {
    motionNoConfidence: Rational;
    committeeNormal: Rational;
    committeeNoConfidence: Rational;
    updateConstitution: Rational;
    hfInitiation: Rational;
    networkParamVoting: Rational;
    economicParamVoting: Rational;
    technicalParamVoting: Rational;
    govParamVoting: Rational;
    treasuryWithdrawal: Rational;
  };
  minCommitteeSize?: number;
  committeeTermLimit?: number;
  govActionValidity?: number;
  govActionDeposit?: bigint;
  dRepDeposit?: bigint;
  dRepInactivity?: number;
  refScriptCostByte?: Rational;
};

export type ParameterChangeAction = {
  type: GovActionType.PARAM_CHANGE_ACTION;
  action: {
    prevActionId: GovActionId | null;
    protocolParamUpdate: ProtocolParamUpdate;
    policyHash: Uint8Array | null;
  };
};

export type HardForkInitAction = {
  type: GovActionType.HF_INIT_ACTION;
  action: {
    prevActionId: GovActionId | null;
    protocolVersion: [number, number];
  };
};

export type TreasuryWithdrawalsAction = {
  type: GovActionType.TREASURY_WITHDRAW_ACTION;
  action: {
    withdrawals: Array<Withdrawal>;
    policyHash: Uint8Array | null;
  };
};

export type NoConfidenceAction = {
  type: GovActionType.NO_CONFIDENCE_ACTION;
  action: {
    prevActionId: GovActionId | null;
  };
};

export type UpdateCommitteeAction = {
  type: GovActionType.UPDATE_COMMITTEE_ACTION;
  action: {
    prevActionId: GovActionId | null;
    removeColdCreds: Array<CommitteeColdCredential>;
    addColdCreds: Array<{
      credential: CommitteeColdCredential;
      epoch: number;
    }>;
    threshold: Rational;
  };
};

export type NewConstitutionAction = {
  type: GovActionType.NEW_CONSTITUTION_ACTION;
  action: {
    prevActionId: GovActionId | null;
    constitution: {
      anchor: Anchor;
      scriptHash: Uint8Array | null;
    };
  };
};

export type InfoAction = {
  type: GovActionType.INFO_ACTION;
};

export type GovAction =
  | ParameterChangeAction
  | HardForkInitAction
  | TreasuryWithdrawalsAction
  | NoConfidenceAction
  | UpdateCommitteeAction
  | NewConstitutionAction
  | InfoAction;

export type GovActionId = {
  txId: Uint8Array;
  index: number;
};

export type Vote = {
  govActionId: GovActionId;
  vote: VoteType;
  anchor: Anchor | null;
};

export type Voter = {
  type: VoterType;
  key: Credential;
};

export type VotingProcedure = {
  voter: Voter;
  votes: Array<Vote>;
  redeemer?: Redeemer;
};

/**
 * A governance proposal. A parameter change or treasury withdrawal with a `policyHash` runs
 * that script: give it as `plutusScript`, or in a reference input, along with its `redeemer`.
 */
export type ProposalProcedure = {
  deposit: bigint;
  rewardAccount: Uint8Array;
  govAction: GovAction;
  anchor: Anchor;
  plutusScript?: PlutusScript;
  redeemer?: Redeemer;
};
