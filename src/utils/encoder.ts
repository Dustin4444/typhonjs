import { CborTag, EncodedCbor, IndefiniteArray, decode, encode } from "@stricahq/cbors";
import {
  CertificateType,
  DRepType,
  GovActionType,
  HashType,
  PlutusScriptType,
  RedeemerTag,
  VoterType,
  WitnessType,
} from "../types";
import type {
  PlutusDataConstructor,
  PlutusData,
  CollateralInput,
  LanguageView,
  AuxiliaryData,
  Certificate,
  Input,
  Metadata,
  Output,
  StakeDelegationCertificate,
  StakeDeRegistrationCertificate,
  StakeRegistrationCertificate,
  Token,
  VKeyWitness,
  Withdrawal,
  NativeScript,
  Mint,
  ReferenceInput,
  StakeKeyRegistrationCertificate,
  StakeKeyDeRegistrationCertificate,
  VoteDelegationCertificate,
  DRep,
  StakeVoteDelegationCertificate,
  StakeRegDelegationCertificate,
  VoteRegDelegationCertificate,
  StakeVoteRegDelegationCertificate,
  CommitteeAuthHotCertificate,
  CommitteeResignColdCertificate,
  Anchor,
  DRepRegCertificate,
  Credential,
  DRepDeRegCertificate,
  DRepUpdateCertificate,
  VotingProcedure,
  Vote,
  Voter,
  ProposalProcedure,
  ProtocolParamUpdate,
  GovActionId,
  PlutusScript,
  Rational,
  Redeemer,
  TaggedRedeemer,
} from "../types";
import { getUniqueTokens, sanitizeMetadata, sortTokens } from "./helpers";
import { hash28, hash32 } from "./crypto";
import { compareCanonicalBytes, concatBytes, fromHex, toHex } from "./bytes";
import { toFraction } from "./rational";
import { OutputItemType } from "../internal-types";
import type {
  EncodedAmount,
  EncodedCertificate,
  EncodedCollateralInput,
  EncodedPlutusData,
  EncodedInput,
  EncodedOutput,
  EncodedPlutusScript,
  EncodedRedeemer,
  EncodedCredential,
  EncodedStakeDelegationCertificate,
  EncodedStakeDeRegistrationCertificate,
  EncodedStakeRegistrationCertificate,
  EncodedTokens,
  EncodedVKeyWitness,
  EncodedWithdrawals,
  EncodedWitnesses,
  EncodedNativeScript,
  EncodedStakeKeyRegistrationCertificate,
  EncodedStakeKeyDeRegistrationCertificate,
  EncodedVoteDelegationCertificate,
  EncodedDRep,
  EncodedStakeVoteDelegationCertificate,
  EncodedStakeRegDelegationCertificate,
  EncodedVoteRegDelegationCertificate,
  EncodedStakeVoteRegDelegationCertificate,
  EncodedCommitteeAuthHotCertificate,
  EncodedCommitteeResignColdCertificate,
  EncodedAnchor,
  EncodedDRepRegCertificate,
  EncodedDRepDeRegCertificate,
  EncodedDRepUpdateCertificate,
  EncodedVotingProcedures,
  EncodedVoter,
  EncodedGovActionId,
  EncodedVotingProcedure,
  EncodedProposalProcedure,
  EncodedGovAction,
  EncodedProtocolParamUpdate,
  EncodedConstitution,
} from "../internal-types";

// language number of a Plutus script in a reference script and in its script hash
const PLUTUS_LANGUAGE: Record<PlutusScriptType, number> = {
  [PlutusScriptType.PlutusScriptV1]: 1,
  [PlutusScriptType.PlutusScriptV2]: 2,
  [PlutusScriptType.PlutusScriptV3]: 3,
};

const PLUTUS_WITNESS: Record<PlutusScriptType, WitnessType> = {
  [PlutusScriptType.PlutusScriptV1]: WitnessType.PLUTUS_SCRIPT_V1,
  [PlutusScriptType.PlutusScriptV2]: WitnessType.PLUTUS_SCRIPT_V2,
  [PlutusScriptType.PlutusScriptV3]: WitnessType.PLUTUS_SCRIPT_V3,
};

const plutusLanguage = (type: PlutusScriptType): number => {
  const language = PLUTUS_LANGUAGE[type];
  if (language === undefined) {
    throw new Error(`Unsupported PlutusScript Version: ${type}`);
  }
  return language;
};

// the content of a complete CBOR byte string (major type 2, nothing left over), if it is one
const decodeCborBytes = (bytes: Uint8Array): Uint8Array | undefined => {
  if (bytes.length === 0 || bytes[0] >> 5 !== 2) return undefined;
  try {
    const content = decode(bytes);
    return content instanceof Uint8Array ? content : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The bytes of a Plutus script as the ledger stores and hashes it: the flat-encoded program
 * wrapped in one CBOR byte string. `cborHex` may be exactly that, or the `cborHex` of a
 * cardano-cli text envelope, which wraps it in a second byte string. The two can't be
 * confused: a flat program starts with its version, never with a byte string header.
 */
export const getPlutusScriptBytes = (cborHex: string): Uint8Array => {
  const bytes = fromHex(cborHex);
  const content = decodeCborBytes(bytes);
  if (!content) {
    throw new Error("Invalid PlutusScript, cborHex must hold a CBOR byte string");
  }
  return decodeCborBytes(content) ? content : bytes;
};

export const getPlutusScriptHash = (plutusScript: PlutusScript): Uint8Array =>
  hash28(
    concatBytes(
      Uint8Array.of(plutusLanguage(plutusScript.type)),
      getPlutusScriptBytes(plutusScript.cborHex)
    )
  );

// a script hash covers the script's language prefix, 0 for native scripts
export const getNativeScriptHash = (nativeScript: NativeScript): Uint8Array =>
  hash28(concatBytes(Uint8Array.of(0), encode(encodeNativeScript(nativeScript))));

// identifies an input regardless of the case of its txId hex
export const txInKey = (txId: string, index: number) => `${txId.toLowerCase()}#${index}`;

// the order the ledger keeps inputs in, which spend redeemers point into
export const sortInputs = <T extends { txId: string; index: number }>(inputs: Array<T>): Array<T> =>
  [...inputs].sort((a, b) => {
    const txIdA = a.txId.toLowerCase();
    const txIdB = b.txId.toLowerCase();
    if (txIdA !== txIdB) return txIdA < txIdB ? -1 : 1;
    return a.index - b.index;
  });

export const encodeInputs = (inputs: Array<Input | ReferenceInput>): Array<EncodedInput> => {
  const encodedInputs: Array<EncodedInput> = inputs.map((input) => {
    return [fromHex(input.txId), input.index];
  });
  return encodedInputs;
};

export const encodeCollaterals = (
  collaterals: Array<CollateralInput>
): Array<EncodedCollateralInput> => {
  const encodedCollateralInputs: Array<EncodedCollateralInput> = collaterals.map((collateral) => {
    return [fromHex(collateral.txId), collateral.index];
  });
  return encodedCollateralInputs;
};

/**
 * Tokens as a multi-asset map. Tokens of one policy share its inner map in the order given,
 * and a repeated asset is summed instead of written as a duplicate key.
 */
export const encodeOutputTokens = (tokens: Array<Token>): EncodedTokens => {
  const policies = new Map<string, Map<string, bigint>>();
  for (const { policyId, assetName, amount } of tokens) {
    const policy = policyId.toLowerCase();
    const asset = assetName.toLowerCase();
    let assets = policies.get(policy);
    if (!assets) {
      assets = new Map();
      policies.set(policy, assets);
    }
    assets.set(asset, (assets.get(asset) ?? 0n) + amount);
  }

  const policyIdMap: EncodedTokens = new Map();
  for (const [policyId, assets] of policies) {
    const tokenMap = new Map<Uint8Array, bigint>();
    for (const [assetName, amount] of assets) {
      tokenMap.set(fromHex(assetName), amount);
    }
    policyIdMap.set(fromHex(policyId), tokenMap);
  }
  return policyIdMap;
};

/**
 * The mint field in canonical order, which is also the order mint redeemers point into.
 * Throws if an asset's quantities add up to zero, which the ledger rejects.
 */
export const encodeMint = (mints: Array<Mint>): EncodedTokens => {
  const tokens: Array<Token> = [];
  for (const { policyId, assets } of mints) {
    for (const { assetName, amount } of assets) {
      tokens.push({ policyId, assetName, amount });
    }
  }
  const uniqueTokens = getUniqueTokens(tokens);
  const zero = uniqueTokens.find(({ amount }) => amount === 0n);
  if (zero) {
    throw new Error(`Mint quantity of ${zero.policyId}.${zero.assetName} is zero`);
  }
  return encodeOutputTokens(sortTokens(uniqueTokens));
};

const encodeScriptRef = (output: Output): unknown => {
  if (output.plutusScript) {
    return [
      plutusLanguage(output.plutusScript.type),
      getPlutusScriptBytes(output.plutusScript.cborHex),
    ];
  }
  if (output.nativeScript) {
    // a native script sits in the script structure as itself, not as encoded bytes
    return [0, encodeNativeScript(output.nativeScript)];
  }
  return undefined;
};

export const encodeOutput = (output: Output): EncodedOutput => {
  const amount: EncodedAmount =
    output.tokens.length > 0 ? [output.amount, encodeOutputTokens(output.tokens)] : output.amount;

  // Babbage era output with inline datum and refScript support
  const encodedOutput: EncodedOutput = new Map();
  encodedOutput.set(OutputItemType.ADDRESS, output.address.getBytes());
  encodedOutput.set(OutputItemType.VALUE, amount);

  if (output.plutusDataHash) {
    encodedOutput.set(OutputItemType.DATUM_OPTION, [0, fromHex(output.plutusDataHash)]);
  } else if (output.plutusData !== undefined) {
    const encodedPlutusData = encode(encodePlutusData(output.plutusData));
    encodedOutput.set(OutputItemType.DATUM_OPTION, [1, new CborTag(encodedPlutusData, 24)]);
  }

  const refScript = encodeScriptRef(output);
  if (refScript) {
    encodedOutput.set(OutputItemType.SCRIPT_REF, new CborTag(encode(refScript), 24));
  }
  return encodedOutput;
};

export const encodeOutputs = (outputs: Array<Output>): Array<EncodedOutput> => {
  return outputs.map((output) => encodeOutput(output));
};

const sortedByKey = <V>(entries: Array<[Uint8Array, V]>): Map<Uint8Array, V> =>
  new Map([...entries].sort(([a], [b]) => compareCanonicalBytes(a, b)));

export const encodeWithdrawals = (withdrawals: Withdrawal[]): EncodedWithdrawals => {
  const rewardAccounts = new Set<string>();
  for (const { rewardAccount } of withdrawals) {
    if (rewardAccounts.has(rewardAccount.getHex())) {
      throw new Error(`Duplicate withdrawal for reward account ${rewardAccount.getBech32()}`);
    }
    rewardAccounts.add(rewardAccount.getHex());
  }
  return sortedByKey(
    withdrawals.map((withdrawal) => [withdrawal.rewardAccount.getBytes(), withdrawal.amount])
  );
};

export const encodeDRep = (drep: DRep): EncodedDRep => {
  let encodedDRep: EncodedDRep;
  switch (drep.type) {
    case DRepType.ADDRESS:
      encodedDRep = [0, drep.key as Uint8Array];
      break;
    case DRepType.SCRIPT:
      encodedDRep = [1, drep.key as Uint8Array];
      break;
    case DRepType.ABSTAIN:
      encodedDRep = [2];
      break;
    case DRepType.NO_CONFIDENCE:
      encodedDRep = [3];
      break;
    default:
      throw new Error("Invalid DRep type");
  }
  return encodedDRep;
};

export const encodeAnchor = (anchor: Anchor | null): EncodedAnchor => {
  if (anchor) {
    return [anchor.url, anchor.hash];
  }
  return null;
};

export const encodeCredential = (credential: Credential): EncodedCredential => {
  const encodedCredential: EncodedCredential = [credential.type, credential.hash];
  return encodedCredential;
};

export const encodeStakeRegistrationCertificate = (
  certificate: StakeRegistrationCertificate
): EncodedStakeRegistrationCertificate => {
  const encodedStakeCredential = encodeCredential(certificate.cert.stakeCredential);
  return [CertificateType.STAKE_REGISTRATION, encodedStakeCredential];
};

export const encodeStakeDeRegistrationCertificate = (
  certificate: StakeDeRegistrationCertificate
): EncodedStakeDeRegistrationCertificate => {
  const encodedStakeCredential = encodeCredential(certificate.cert.stakeCredential);
  return [CertificateType.STAKE_DE_REGISTRATION, encodedStakeCredential];
};

export const encodeStakeDelegationCertificate = (
  certificate: StakeDelegationCertificate
): EncodedStakeDelegationCertificate => {
  const encodedStakeCredential = encodeCredential(certificate.cert.stakeCredential);
  const poolHash = fromHex(certificate.cert.poolHash);
  return [CertificateType.STAKE_DELEGATION, encodedStakeCredential, poolHash];
};

export const encodeStakeKeyRegistrationCertificate = (
  certificate: StakeKeyRegistrationCertificate
): EncodedStakeKeyRegistrationCertificate => {
  const encodedStakeCredential = encodeCredential(certificate.cert.stakeCredential);
  return [CertificateType.STAKE_KEY_REGISTRATION, encodedStakeCredential, certificate.cert.deposit];
};

export const encodeStakeKeyDeRegistrationCertificate = (
  certificate: StakeKeyDeRegistrationCertificate
): EncodedStakeKeyDeRegistrationCertificate => {
  const encodedStakeCredential = encodeCredential(certificate.cert.stakeCredential);
  return [
    CertificateType.STAKE_KEY_DE_REGISTRATION,
    encodedStakeCredential,
    certificate.cert.deposit,
  ];
};

export const encodeVoteDelegationCertificate = (
  certificate: VoteDelegationCertificate
): EncodedVoteDelegationCertificate => {
  const encodedStakeCredential = encodeCredential(certificate.cert.stakeCredential);
  const encodedDRep = encodeDRep(certificate.cert.dRep);
  return [CertificateType.VOTE_DELEGATION, encodedStakeCredential, encodedDRep];
};

export const encodeStakeVoteDelegationCertificate = (
  certificate: StakeVoteDelegationCertificate
): EncodedStakeVoteDelegationCertificate => {
  const encodedStakeCredential = encodeCredential(certificate.cert.stakeCredential);
  const encodedDRep = encodeDRep(certificate.cert.dRep);
  return [
    CertificateType.STAKE_VOTE_DELEG,
    encodedStakeCredential,
    certificate.cert.poolKeyHash,
    encodedDRep,
  ];
};

export const encodeStakeRegDelegationCertificate = (
  certificate: StakeRegDelegationCertificate
): EncodedStakeRegDelegationCertificate => {
  const encodedStakeCredential = encodeCredential(certificate.cert.stakeCredential);
  return [
    CertificateType.STAKE_REG_DELEG,
    encodedStakeCredential,
    certificate.cert.poolKeyHash,
    certificate.cert.deposit,
  ];
};

export const encodeVoteRegDelegationCertificate = (
  certificate: VoteRegDelegationCertificate
): EncodedVoteRegDelegationCertificate => {
  const encodedStakeCredential = encodeCredential(certificate.cert.stakeCredential);
  const encodedDRep = encodeDRep(certificate.cert.dRep);
  return [
    CertificateType.VOTE_REG_DELEG,
    encodedStakeCredential,
    encodedDRep,
    certificate.cert.deposit,
  ];
};

export const encodeStakeVoteRegDelegationCertificate = (
  certificate: StakeVoteRegDelegationCertificate
): EncodedStakeVoteRegDelegationCertificate => {
  const encodedStakeCredential = encodeCredential(certificate.cert.stakeCredential);
  const encodedDRep = encodeDRep(certificate.cert.dRep);
  return [
    CertificateType.STAKE_VOTE_REG_DELEG,
    encodedStakeCredential,
    certificate.cert.poolKeyHash,
    encodedDRep,
    certificate.cert.deposit,
  ];
};

export const encodeCommitteeAuthHotCertificate = (
  certificate: CommitteeAuthHotCertificate
): EncodedCommitteeAuthHotCertificate => {
  const encodedCommitteeColdCred = encodeCredential(certificate.cert.coldCredential);
  const encodedCommitteeHotCred = encodeCredential(certificate.cert.hotCredential);

  return [CertificateType.COMMITTEE_AUTH_HOT, encodedCommitteeColdCred, encodedCommitteeHotCred];
};

export const encodeCommitteeResignColdCertificate = (
  certificate: CommitteeResignColdCertificate
): EncodedCommitteeResignColdCertificate => {
  const encodedCommitteeColdCred = encodeCredential(certificate.cert.coldCredential);
  return [
    CertificateType.COMMITTEE_RESIGN_COLD,
    encodedCommitteeColdCred,
    encodeAnchor(certificate.cert.anchor),
  ];
};

export const encodeDRepRegCertificate = (
  certificate: DRepRegCertificate
): EncodedDRepRegCertificate => {
  const encodedDRepCred = encodeCredential(certificate.cert.dRepCredential);

  return [
    CertificateType.DREP_REG,
    encodedDRepCred,
    certificate.cert.deposit,
    encodeAnchor(certificate.cert.anchor),
  ];
};

export const encodeDRepDeRegCertificate = (
  certificate: DRepDeRegCertificate
): EncodedDRepDeRegCertificate => {
  const encodedDRepCred = encodeCredential(certificate.cert.dRepCredential);

  return [CertificateType.DREP_DE_REG, encodedDRepCred, certificate.cert.deposit];
};

export const encodeDRepUpdateCertificate = (
  certificate: DRepUpdateCertificate
): EncodedDRepUpdateCertificate => {
  const encodedDRepCred = encodeCredential(certificate.cert.dRepCredential);

  return [CertificateType.DREP_UPDATE, encodedDRepCred, encodeAnchor(certificate.cert.anchor)];
};

export const encodeCertificates = (certificates: Array<Certificate>): Array<EncodedCertificate> => {
  const encodedCertificates: Array<EncodedCertificate> = [];

  certificates.forEach((certificate) => {
    switch (certificate.type) {
      case CertificateType.STAKE_REGISTRATION: {
        encodedCertificates.push(encodeStakeRegistrationCertificate(certificate));
        break;
      }
      case CertificateType.STAKE_DE_REGISTRATION: {
        encodedCertificates.push(encodeStakeDeRegistrationCertificate(certificate));
        break;
      }
      case CertificateType.STAKE_DELEGATION: {
        encodedCertificates.push(encodeStakeDelegationCertificate(certificate));
        break;
      }
      case CertificateType.STAKE_KEY_REGISTRATION: {
        encodedCertificates.push(encodeStakeKeyRegistrationCertificate(certificate));
        break;
      }
      case CertificateType.STAKE_KEY_DE_REGISTRATION: {
        encodedCertificates.push(encodeStakeKeyDeRegistrationCertificate(certificate));
        break;
      }
      case CertificateType.VOTE_DELEGATION: {
        encodedCertificates.push(encodeVoteDelegationCertificate(certificate));
        break;
      }
      case CertificateType.STAKE_VOTE_DELEG: {
        encodedCertificates.push(encodeStakeVoteDelegationCertificate(certificate));
        break;
      }
      case CertificateType.STAKE_REG_DELEG: {
        encodedCertificates.push(encodeStakeRegDelegationCertificate(certificate));
        break;
      }
      case CertificateType.VOTE_REG_DELEG: {
        encodedCertificates.push(encodeVoteRegDelegationCertificate(certificate));
        break;
      }
      case CertificateType.STAKE_VOTE_REG_DELEG: {
        encodedCertificates.push(encodeStakeVoteRegDelegationCertificate(certificate));
        break;
      }
      case CertificateType.COMMITTEE_AUTH_HOT: {
        encodedCertificates.push(encodeCommitteeAuthHotCertificate(certificate));
        break;
      }
      case CertificateType.COMMITTEE_RESIGN_COLD: {
        encodedCertificates.push(encodeCommitteeResignColdCertificate(certificate));
        break;
      }
      case CertificateType.DREP_REG: {
        encodedCertificates.push(encodeDRepRegCertificate(certificate));
        break;
      }
      case CertificateType.DREP_DE_REG: {
        encodedCertificates.push(encodeDRepDeRegCertificate(certificate));
        break;
      }
      case CertificateType.DREP_UPDATE: {
        encodedCertificates.push(encodeDRepUpdateCertificate(certificate));
        break;
      }
      default:
        throw new Error("unsupported certificate type");
    }
  });
  return encodedCertificates;
};

export const encodeVKeyWitness = (vKeyWitness: Array<VKeyWitness>): Array<EncodedVKeyWitness> => {
  // create a map of unique v keys
  const vKeyMap: Map<string, VKeyWitness> = new Map();
  for (const vKey of vKeyWitness) {
    vKeyMap.set(toHex(vKey.publicKey), vKey);
  }

  const encodedVKeyWitness: Array<EncodedVKeyWitness> = [];
  for (const { publicKey, signature } of vKeyMap.values()) {
    encodedVKeyWitness.push([publicKey, signature]);
  }
  return encodedVKeyWitness;
};

const voterKey = (voter: Voter) => `${voter.type}#${toHex(voter.key.hash)}`;

const credentialRank = (credential: Credential) => (credential.type === HashType.SCRIPT ? 0 : 1);

// the ledger's order of credentials: script hashes before key hashes, each by hash
const compareCredentials = (a: Credential, b: Credential): number =>
  credentialRank(a) - credentialRank(b) || compareCanonicalBytes(a.hash, b.hash);

// the ledger's order of voters: committee members, then DReps, then pools, a script before a key
const VOTER_RANK: Record<VoterType, number> = {
  [VoterType.CC_HOT_SCRIPT]: 0,
  [VoterType.CC_HOT_KEY]: 1,
  [VoterType.DREP_SCRIPT]: 2,
  [VoterType.DREP_KEY]: 3,
  [VoterType.POOL_KEY]: 4,
};

/**
 * Every redeemer with the index of what it redeems. Certificates and proposals are indexed in
 * the order they're in. Inputs, policies, reward accounts and voters are indexed in the order the
 * ledger keeps them, which for reward accounts and voters isn't the order of their bytes: a
 * script credential comes before a key credential.
 */
export const collectRedeemers = ({
  inputs,
  mints,
  certificates,
  withdrawals,
  votingProcedures,
  proposalProcedures,
}: {
  inputs: Array<Input>;
  mints: Array<Mint>;
  certificates: Array<Certificate>;
  withdrawals: Array<Withdrawal>;
  votingProcedures: Array<VotingProcedure>;
  proposalProcedures: Array<ProposalProcedure>;
}): Array<TaggedRedeemer> => {
  const redeemers: Array<TaggedRedeemer> = [];
  const add = (tag: RedeemerTag, index: number, redeemer: Redeemer | undefined) => {
    if (redeemer) {
      redeemers.push({ tag, index, redeemer });
    }
  };

  for (const [index, { redeemer }] of sortInputs(inputs).entries()) {
    add(RedeemerTag.SPEND, index, redeemer);
  }

  const policyIds = [
    ...new Set(
      mints.filter(({ assets }) => assets.length > 0).map(({ policyId }) => policyId.toLowerCase())
    ),
  ].sort();
  for (const [index, policyId] of policyIds.entries()) {
    const redeemed = mints.filter(
      (mint) => mint.policyId.toLowerCase() === policyId && mint.redeemer
    );
    if (redeemed.length > 1) {
      throw new Error(`Multiple redeemers for minting policy ${policyId}`);
    }
    add(RedeemerTag.MINT, index, redeemed[0]?.redeemer);
  }

  for (const [index, certificate] of certificates.entries()) {
    add(RedeemerTag.CERT, index, "redeemer" in certificate ? certificate.redeemer : undefined);
  }

  const rewardAccounts = [...withdrawals].sort(
    (a, b) =>
      a.rewardAccount.getNetworkId() - b.rewardAccount.getNetworkId() ||
      compareCredentials(a.rewardAccount.stakeCredential, b.rewardAccount.stakeCredential)
  );
  for (const [index, { redeemer }] of rewardAccounts.entries()) {
    add(RedeemerTag.REWARD, index, redeemer);
  }

  // the ledger keys voting procedures by voter, so a voter counts once however many it has
  const voters: Map<string, { voter: Voter; redeemer?: Redeemer }> = new Map();
  for (const { voter, redeemer } of votingProcedures) {
    const entry = voters.get(voterKey(voter)) ?? { voter };
    if (redeemer) {
      if (entry.redeemer) {
        throw new Error(`Multiple redeemers for voter ${toHex(voter.key.hash)}`);
      }
      entry.redeemer = redeemer;
    }
    voters.set(voterKey(voter), entry);
  }
  const sortedVoters = [...voters.values()].sort(
    (a, b) =>
      VOTER_RANK[a.voter.type] - VOTER_RANK[b.voter.type] ||
      compareCanonicalBytes(a.voter.key.hash, b.voter.key.hash)
  );
  for (const [index, { redeemer }] of sortedVoters.entries()) {
    add(RedeemerTag.VOTING, index, redeemer);
  }

  for (const [index, { redeemer }] of proposalProcedures.entries()) {
    add(RedeemerTag.PROPOSING, index, redeemer);
  }
  return redeemers;
};

export const encodeWitnesses = (
  vKeyWitness: Array<VKeyWitness>,
  plutusDataList: Array<PlutusData>,
  plutusScriptMap: Map<string, PlutusScriptType>,
  nativeScripts: Array<NativeScript>,
  redeemers: Array<TaggedRedeemer>
): EncodedWitnesses => {
  const encodedWitnesses: EncodedWitnesses = new Map();
  if (vKeyWitness.length > 0) {
    encodedWitnesses.set(WitnessType.V_KEY_WITNESS, encodeVKeyWitness(vKeyWitness));
  }

  const encodedPlutusDataMap: Map<string, EncodedPlutusData> = new Map();
  for (const d of plutusDataList) {
    const encodedPlutusData = encodePlutusData(d);
    const edHash = hash32(encode(encodedPlutusData));
    encodedPlutusDataMap.set(toHex(edHash), encodedPlutusData);
  }

  const encodedRedeemers: Array<EncodedRedeemer> = redeemers.map(({ tag, index, redeemer }) => [
    tag,
    index,
    encodePlutusData(redeemer.plutusData),
    [redeemer.exUnits.mem, redeemer.exUnits.steps],
  ]);

  // one witness per script, whichever cborHex form it was given in
  const encodedPlutusScripts: Map<WitnessType, Map<string, EncodedPlutusScript>> = new Map();
  for (const [script, scriptType] of plutusScriptMap) {
    const key = PLUTUS_WITNESS[scriptType];
    if (key === undefined) {
      throw new Error("Unsupported PlutusScript Version");
    }
    const scriptBytes = getPlutusScriptBytes(script);
    const scripts = encodedPlutusScripts.get(key) ?? new Map();
    scripts.set(toHex(scriptBytes), scriptBytes);
    encodedPlutusScripts.set(key, scripts);
  }
  const plutusScriptsV1 = encodedPlutusScripts.get(WitnessType.PLUTUS_SCRIPT_V1);
  if (plutusScriptsV1) {
    encodedWitnesses.set(WitnessType.PLUTUS_SCRIPT_V1, [...plutusScriptsV1.values()]);
  }
  const plutusScriptsV2 = encodedPlutusScripts.get(WitnessType.PLUTUS_SCRIPT_V2);
  if (plutusScriptsV2) {
    encodedWitnesses.set(WitnessType.PLUTUS_SCRIPT_V2, [...plutusScriptsV2.values()]);
  }
  const plutusScriptsV3 = encodedPlutusScripts.get(WitnessType.PLUTUS_SCRIPT_V3);
  if (plutusScriptsV3) {
    encodedWitnesses.set(WitnessType.PLUTUS_SCRIPT_V3, [...plutusScriptsV3.values()]);
  }

  const encodedNativeScriptMap: Map<string, EncodedNativeScript> = new Map();
  for (const ns of nativeScripts) {
    const encodedNativeScript = encodeNativeScript(ns);
    encodedNativeScriptMap.set(toHex(encode(encodedNativeScript)), encodedNativeScript);
  }

  const encodedNativeScripts = [...encodedNativeScriptMap.values()];
  if (encodedNativeScripts.length) {
    encodedWitnesses.set(WitnessType.NATIVE_SCRIPT, encodedNativeScripts);
  }

  const encodedPlutusDataList = [...encodedPlutusDataMap.values()];
  if (encodedPlutusDataList.length) {
    encodedWitnesses.set(WitnessType.PLUTUS_DATA, encodedPlutusDataList);
  }

  if (encodedRedeemers.length) {
    encodedWitnesses.set(WitnessType.REDEEMER, encodedRedeemers);
  }

  return encodedWitnesses;
};

export const encodeMetadata = (metadataArray: Array<Metadata>): Map<number, unknown> => {
  const encodedMetadata = new Map();
  for (const { label, data } of metadataArray) {
    if (!Number.isSafeInteger(label) || label < 0) {
      throw new Error(`Metadata label must be a non-negative integer, got ${label}`);
    }
    if (encodedMetadata.has(label)) {
      throw new Error(`Duplicate metadata label ${label}`);
    }
    encodedMetadata.set(label, sanitizeMetadata(data));
  }
  return encodedMetadata;
};

export const encodeAuxiliaryData = (auxiliaryData: AuxiliaryData): CborTag => {
  const encodedMetadata = encodeMetadata(auxiliaryData.metadata);
  const auxDataMap = new Map();
  auxDataMap.set(0, encodedMetadata);
  return new CborTag(auxDataMap, 259);
};

// Plutus reads a byte string of at most 64 bytes, or an indefinite one made of 64-byte chunks
const PLUTUS_BYTES_CHUNK = 64;
const encodeBoundedBytes = (bytes: Uint8Array): Uint8Array | EncodedCbor => {
  if (bytes.length <= PLUTUS_BYTES_CHUNK) {
    return bytes;
  }
  const chunks: Array<Uint8Array> = [Uint8Array.of(0x5f)];
  for (let offset = 0; offset < bytes.length; offset += PLUTUS_BYTES_CHUNK) {
    chunks.push(encode(bytes.subarray(offset, offset + PLUTUS_BYTES_CHUNK)));
  }
  chunks.push(Uint8Array.of(0xff));
  return new EncodedCbor(concatBytes(...chunks));
};

const MAX_UINT64 = 2n ** 64n - 1n;

const bigIntToBytes = (value: bigint): Uint8Array => {
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return fromHex(hex);
};

// an integer within 64 bits is a plain CBOR integer, beyond that a bignum (tag 2, or tag 3
// holding -1 - n) whose bytes are bounded like any Plutus byte string
const encodePlutusInteger = (value: bigint): bigint | CborTag => {
  if (value >= -MAX_UINT64 - 1n && value <= MAX_UINT64) {
    return value;
  }
  const negative = value < 0n;
  return new CborTag(
    encodeBoundedBytes(bigIntToBytes(negative ? -value - 1n : value)),
    negative ? 3 : 2
  );
};

const PlutusDataObjectKeys = ["constructor", "fields"];
const createConstructor = (pConstructor: PlutusDataConstructor) => {
  const keys = Object.keys(pConstructor);
  if (!(
    keys.every((val) => PlutusDataObjectKeys.includes(val)) &&
    Number.isSafeInteger(pConstructor.constructor) &&
    pConstructor.constructor >= 0 &&
    Array.isArray(pConstructor.fields)
  )) {
    throw new Error("Invalid PlutusData supplied");
  }
  // array is definite length if empty
  let fields: Array<EncodedPlutusData> = [];
  if (pConstructor.fields.length > 0) {
    fields = new IndefiniteArray();
    for (const field of pConstructor.fields) {
      fields.push(encodePlutusData(field));
    }
  }
  if (pConstructor.constructor < 7) {
    return new CborTag(fields, 121 + pConstructor.constructor);
  }
  if (pConstructor.constructor < 128) {
    return new CborTag(fields, 1280 + (pConstructor.constructor - 7));
  }
  return new CborTag([pConstructor.constructor, fields], 102);
};

/**
 * Plutus data, encoded the way a script serializes it so datum hashes match the ones computed
 * on chain: non-empty lists and constructor fields with an indefinite length, maps with a
 * definite one.
 */
export const encodePlutusData = (plutusData: PlutusData): EncodedPlutusData => {
  if (typeof plutusData === "number") {
    if (!Number.isSafeInteger(plutusData)) {
      throw new Error(`PlutusData integers must be safe integers, use a bigint for ${plutusData}`);
    }
    return plutusData;
  }
  if (typeof plutusData === "bigint") {
    return encodePlutusInteger(plutusData);
  }
  if (plutusData instanceof Uint8Array) {
    return encodeBoundedBytes(plutusData);
  }
  if (Array.isArray(plutusData)) {
    if (plutusData.length > 0) {
      const ary = new IndefiniteArray();
      for (const d of plutusData) {
        ary.push(encodePlutusData(d));
      }
      return ary;
    }
    return [];
  }
  if (plutusData instanceof Map) {
    const map = new Map<EncodedPlutusData, EncodedPlutusData>();
    for (const [key, value] of plutusData) {
      map.set(encodePlutusData(key), encodePlutusData(value));
    }
    return map;
  }
  if (typeof plutusData === "string") {
    throw new Error("String not supported in PlutusData");
  }
  if (typeof plutusData === "object" && plutusData !== null) {
    return createConstructor(plutusData);
  }
  throw new Error("Invalid PlutusData supplied");
};

/**
 * The language views of the script integrity hash, keyed in the ledger's order: by the length
 * of the encoded key, then bytewise. PlutusV1's key is a byte string, so it comes after
 * PlutusV2's and PlutusV3's integer keys.
 */
export const encodeLanguageViews = (
  languageView: LanguageView | undefined,
  plutusV1: boolean,
  plutusV2: boolean,
  plutusV3: boolean
): Uint8Array => {
  const encodedLanguageView = new Map();

  if (plutusV2) {
    if (!languageView || !languageView.PlutusScriptV2) {
      throw new Error("Language view for PlutusV2 is required");
    }
    // The encoding is Plutus V2 Specific
    encodedLanguageView.set(1, languageView.PlutusScriptV2);
  }
  if (plutusV3) {
    if (!languageView || !languageView.PlutusScriptV3) {
      throw new Error("Language view for PlutusV3 is required");
    }
    encodedLanguageView.set(2, languageView.PlutusScriptV3);
  }
  if (plutusV1) {
    if (!languageView || !languageView.PlutusScriptV1) {
      throw new Error("Language view for PlutusV1 is required");
    }
    // The encoding is Plutus V1 Specific
    // indefinite array encoding
    const indefCostMdls = IndefiniteArray.from(languageView.PlutusScriptV1);

    // for V1, the language id and the cost model are encoded before going into the view map
    encodedLanguageView.set(encode(0), encode(indefCostMdls));
  }

  return encode(encodedLanguageView);
};

/**
 * The script integrity hash, required once a transaction carries redeemers, datums or
 * Plutus scripts. With datums but no redeemers, Conway hashes the redeemers as an empty map.
 */
export const generateScriptDataHash = (
  languageView: LanguageView | undefined,
  witnesses: EncodedWitnesses,
  isPlutusV1: boolean,
  isPlutusV2: boolean,
  isPlutusV3: boolean
): Uint8Array | undefined => {
  const encodedPlutusDataList = witnesses.get(WitnessType.PLUTUS_DATA);
  const encodedRedeemers = witnesses.get(WitnessType.REDEEMER);
  const hasDatums = encodedPlutusDataList !== undefined && encodedPlutusDataList.length > 0;
  const hasRedeemers = encodedRedeemers !== undefined && encodedRedeemers.length > 0;
  if (!hasDatums && !hasRedeemers && !isPlutusV1 && !isPlutusV2 && !isPlutusV3) {
    return undefined;
  }

  const redeemerCbor = hasRedeemers ? encode(encodedRedeemers) : encode(new Map());
  const plutusDataCbor = hasDatums ? encode(encodedPlutusDataList) : new Uint8Array(0);
  const langViewCbor = encodeLanguageViews(languageView, isPlutusV1, isPlutusV2, isPlutusV3);

  return hash32(concatBytes(redeemerCbor, plutusDataCbor, langViewCbor));
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const encodeNativeScript = (nativeScript: NativeScript): EncodedNativeScript => {
  if (!isObject(nativeScript)) {
    throw new Error("Invalid native script");
  }
  if ("pubKeyHash" in nativeScript) {
    return [0, fromHex(nativeScript.pubKeyHash)];
  }
  if ("all" in nativeScript) {
    return [1, nativeScript.all.map((ns) => encodeNativeScript(ns))];
  }
  if ("any" in nativeScript) {
    return [2, nativeScript.any.map((ns) => encodeNativeScript(ns))];
  }
  if ("n" in nativeScript) {
    return [3, nativeScript.n, nativeScript.k.map((ns) => encodeNativeScript(ns))];
  }
  if ("invalidBefore" in nativeScript) {
    return [4, nativeScript.invalidBefore];
  }
  if ("invalidAfter" in nativeScript) {
    return [5, nativeScript.invalidAfter];
  }
  throw new Error("Invalid native script");
};

const encodeGovActionId = (govActionId: GovActionId | null): EncodedGovActionId | null =>
  govActionId ? [govActionId.txId, govActionId.index] : null;

const sortedByEncodedKey = <K, V>(entries: Array<[K, V]>): Map<K, V> =>
  new Map(
    entries
      .map(([key, value]) => ({ key, value, encoded: encode(key) }))
      .sort((a, b) => compareCanonicalBytes(a.encoded, b.encoded))
      .map(({ key, value }): [K, V] => [key, value])
  );

export const encodeVotingProcedures = (
  votingProcedures: Array<VotingProcedure>
): EncodedVotingProcedures => {
  // one entry per voter, and within it one per governance action: a later vote on the same
  // action replaces an earlier one, as a map can't hold both
  const voters: Map<string, { voter: Voter; votes: Map<string, Vote> }> = new Map();
  for (const { voter, votes } of votingProcedures) {
    let entry = voters.get(voterKey(voter));
    if (!entry) {
      entry = { voter, votes: new Map() };
      voters.set(voterKey(voter), entry);
    }
    for (const vote of votes) {
      entry.votes.set(`${toHex(vote.govActionId.txId)}#${vote.govActionId.index}`, vote);
    }
  }

  // encode voting procedures as per conway CDDL
  const encodedVoters: Array<[EncodedVoter, Map<EncodedGovActionId, EncodedVotingProcedure>]> = [];
  for (const { voter, votes } of voters.values()) {
    const encodedVoter: EncodedVoter = [voter.type, voter.key.hash];
    const encodedVotes: Array<[EncodedGovActionId, EncodedVotingProcedure]> = [];
    for (const vote of votes.values()) {
      encodedVotes.push([
        encodeGovActionId(vote.govActionId)!,
        [vote.vote, encodeAnchor(vote.anchor)],
      ]);
    }
    encodedVoters.push([encodedVoter, sortedByEncodedKey(encodedVotes)]);
  }
  return sortedByEncodedKey(encodedVoters);
};

const encodeRational = (value: Rational, name: string): CborTag => {
  const { numerator, denominator } = toFraction(value, name);
  return new CborTag([numerator, denominator], 30);
};

// encode protocol param change update data following the Conway CDDL specification
export const encodeProtocolParamUpdate = (ppu: ProtocolParamUpdate) => {
  const encodedParamUpdate: EncodedProtocolParamUpdate = new Map();
  const set = (key: number, value: unknown) => {
    if (value !== undefined) {
      encodedParamUpdate.set(key, value);
    }
  };
  const rational = (value: Rational | undefined, name: string) =>
    value === undefined ? undefined : encodeRational(value, name);

  set(0, ppu.minFeeA);
  set(1, ppu.minFeeB);
  set(2, ppu.maxBlockBodySize);
  set(3, ppu.maxTransactionSize);
  set(4, ppu.maxBlockHeaderSize);
  set(5, ppu.stakeKeyDeposit);
  set(6, ppu.poolDeposit);
  set(7, ppu.poolRetireMaxEpoch);
  set(8, ppu.n);
  set(9, rational(ppu.pledgeInfluence, "pledgeInfluence"));
  set(10, rational(ppu.expansionRate, "expansionRate"));
  set(11, rational(ppu.treasuryGrowthRate, "treasuryGrowthRate"));
  set(16, ppu.minPoolCost);
  set(17, ppu.adaPerUtxoByte);
  if (ppu.costMdls) {
    const encodedCostMdls = new Map();
    if (ppu.costMdls.plutusV1) {
      encodedCostMdls.set(0, ppu.costMdls.plutusV1);
    }
    if (ppu.costMdls.plutusV2) {
      encodedCostMdls.set(1, ppu.costMdls.plutusV2);
    }
    if (ppu.costMdls.plutusV3) {
      encodedCostMdls.set(2, ppu.costMdls.plutusV3);
    }
    set(18, encodedCostMdls);
  }
  if (ppu.exUnitPrices) {
    set(19, [
      encodeRational(ppu.exUnitPrices.mem, "exUnitPrices.mem"),
      encodeRational(ppu.exUnitPrices.steps, "exUnitPrices.steps"),
    ]);
  }
  if (ppu.maxTxExUnits) {
    set(20, [ppu.maxTxExUnits.mem, ppu.maxTxExUnits.steps]);
  }
  if (ppu.maxBlockExUnits) {
    set(21, [ppu.maxBlockExUnits.mem, ppu.maxBlockExUnits.steps]);
  }
  set(22, ppu.maxValueSize);
  set(23, ppu.collateralPercent);
  set(24, ppu.maxCollateralInputs);
  if (ppu.poolVotingThreshold) {
    const t = ppu.poolVotingThreshold;
    set(25, [
      encodeRational(t.motionNoConfidence, "poolVotingThreshold.motionNoConfidence"),
      encodeRational(t.committeeNormal, "poolVotingThreshold.committeeNormal"),
      encodeRational(t.committeeNoConfidence, "poolVotingThreshold.committeeNoConfidence"),
      encodeRational(t.hfInitiation, "poolVotingThreshold.hfInitiation"),
      encodeRational(t.securityParamVoting, "poolVotingThreshold.securityParamVoting"),
    ]);
  }
  if (ppu.dRepVotingThreshold) {
    const t = ppu.dRepVotingThreshold;
    set(26, [
      encodeRational(t.motionNoConfidence, "dRepVotingThreshold.motionNoConfidence"),
      encodeRational(t.committeeNormal, "dRepVotingThreshold.committeeNormal"),
      encodeRational(t.committeeNoConfidence, "dRepVotingThreshold.committeeNoConfidence"),
      encodeRational(t.updateConstitution, "dRepVotingThreshold.updateConstitution"),
      encodeRational(t.hfInitiation, "dRepVotingThreshold.hfInitiation"),
      encodeRational(t.networkParamVoting, "dRepVotingThreshold.networkParamVoting"),
      encodeRational(t.economicParamVoting, "dRepVotingThreshold.economicParamVoting"),
      encodeRational(t.technicalParamVoting, "dRepVotingThreshold.technicalParamVoting"),
      encodeRational(t.govParamVoting, "dRepVotingThreshold.govParamVoting"),
      encodeRational(t.treasuryWithdrawal, "dRepVotingThreshold.treasuryWithdrawal"),
    ]);
  }
  set(27, ppu.minCommitteeSize);
  set(28, ppu.committeeTermLimit);
  set(29, ppu.govActionValidity);
  set(30, ppu.govActionDeposit);
  set(31, ppu.dRepDeposit);
  set(32, ppu.dRepInactivity);
  set(33, rational(ppu.refScriptCostByte, "refScriptCostByte"));

  return encodedParamUpdate;
};

// encode proposal procedure following the Conway CDDL specification
export const encodeProposalProcedures = (
  proposalProcedures: Array<ProposalProcedure>
): Array<EncodedProposalProcedure> => {
  const encodedProposalProcedures: Array<EncodedProposalProcedure> = [];
  for (const pp of proposalProcedures) {
    let encodedGovAction: EncodedGovAction;
    switch (pp.govAction.type) {
      case GovActionType.PARAM_CHANGE_ACTION: {
        encodedGovAction = [
          0,
          encodeGovActionId(pp.govAction.action.prevActionId),
          encodeProtocolParamUpdate(pp.govAction.action.protocolParamUpdate),
          pp.govAction.action.policyHash,
        ];
        break;
      }
      case GovActionType.HF_INIT_ACTION: {
        encodedGovAction = [
          1,
          encodeGovActionId(pp.govAction.action.prevActionId),
          pp.govAction.action.protocolVersion,
        ];
        break;
      }
      case GovActionType.TREASURY_WITHDRAW_ACTION: {
        encodedGovAction = [
          2,
          encodeWithdrawals(pp.govAction.action.withdrawals),
          pp.govAction.action.policyHash,
        ];
        break;
      }
      case GovActionType.NO_CONFIDENCE_ACTION: {
        encodedGovAction = [3, encodeGovActionId(pp.govAction.action.prevActionId)];
        break;
      }
      case GovActionType.UPDATE_COMMITTEE_ACTION: {
        const encodedRemovedColdCreds = pp.govAction.action.removeColdCreds.map((cred) => {
          return encodeCredential(cred);
        });

        const encodedAddColdCreds = new Map();
        for (const addColdCred of pp.govAction.action.addColdCreds) {
          encodedAddColdCreds.set(encodeCredential(addColdCred.credential), addColdCred.epoch);
        }

        encodedGovAction = [
          4,
          encodeGovActionId(pp.govAction.action.prevActionId),
          encodedRemovedColdCreds,
          encodedAddColdCreds,
          encodeRational(pp.govAction.action.threshold, "threshold"),
        ];
        break;
      }
      case GovActionType.NEW_CONSTITUTION_ACTION: {
        const encodedConstitution: EncodedConstitution = [
          encodeAnchor(pp.govAction.action.constitution.anchor),
          pp.govAction.action.constitution.scriptHash,
        ];

        encodedGovAction = [
          5,
          encodeGovActionId(pp.govAction.action.prevActionId),
          encodedConstitution,
        ];
        break;
      }
      case GovActionType.INFO_ACTION: {
        encodedGovAction = [6];
        break;
      }
      default:
        throw new Error("Unknown type of gov action");
    }
    encodedProposalProcedures.push([
      pp.deposit,
      pp.rewardAccount,
      encodedGovAction,
      encodeAnchor(pp.anchor),
    ]);
  }
  return encodedProposalProcedures;
};
