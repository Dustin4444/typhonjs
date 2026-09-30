<p align="center">
  <a href="https://strica.io/" target="_blank">
    <img src="https://docs.strica.io/images/logo.png" width="200">
  </a>
</p>

# @stricahq/typhonjs

[![npm](https://img.shields.io/npm/v/@stricahq/typhonjs.svg)](https://www.npmjs.com/package/@stricahq/typhonjs)
[![downloads](https://img.shields.io/npm/dm/@stricahq/typhonjs.svg)](https://www.npmjs.com/package/@stricahq/typhonjs)
[![node](https://img.shields.io/node/v/@stricahq/typhonjs.svg)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/@stricahq/typhonjs.svg)](./LICENSE)

Pure JavaScript Cardano wallet library.

- Parse and create every type of Cardano address
- Build transactions with automatic UTxO selection, fee calculation and change
- Mint and burn tokens
- Lock funds at Plutus V1, V2 and V3 scripts and spend them
- Stake, withdraw rewards, delegate to a DRep, vote and submit governance proposals
- Attach metadata

It doesn't use any Node.js builtins, so it runs in Node.js and in the browser without polyfills.

## v4 is a breaking change

v4 is ESM-only, needs Node 22.12 or later, and uses `bigint` and `Uint8Array` where 3.x used `BigNumber` and `Buffer`.

### Migrating from 3.x

| 3.x | 4.x |
|---|---|
| `BigNumber` amounts, fees, deposits and protocol parameters | `bigint` |
| `priceMem`, `priceSteps` and `minFeeRefScriptCostPerByte` as `BigNumber` | `Rational`, such as `0.0577`, `"577/10000"` or `[577, 10000]` |
| `collateralPercent` and `ProtocolParamUpdate.maxValueSize` as `BigNumber` | `number` |
| `BigNumber` in `PlutusData` | `bigint` |
| `Buffer` in and out | `Uint8Array` out, `Buffer` still accepted as input |
| `bytes.toString("hex")` | `utils.toHex(bytes)` |
| `Buffer.from(hex, "hex")` | `utils.fromHex(hex)` |
| Plutus data maps with an indefinite length | definite length, so the hash of a datum that holds a map changes |
| `prepareTransaction` adds no collateral return | it adds a collateral return and total collateral to Plutus transactions |
| `prepareTransaction` always spends the first UTxO in `inputs` | it spends none when the inputs you added cover the transaction |
| Node.js polyfills for browser bundles | no Node.js builtins |
| CommonJS package | ESM only, `require(esm)` on Node >= 22.12 |

## Installation

```sh
yarn add @stricahq/typhonjs
```

### Browser

```html
<script src="https://cdn.jsdelivr.net/npm/@stricahq/typhonjs/dist/index.min.js"></script>
<script>
  const { Transaction, utils } = typhonjs;
</script>
```

## Addresses

`utils.getAddressFromString` reads any bech32 or Byron address and gives you back an address object:

```js
import { address, types, utils } from "@stricahq/typhonjs";

const receiver = utils.getAddressFromString(
  "addr1q9dmtr22dz54qn8pgx4yhle64nhwpqjyxsueaetdcxxa7k5jhh20yrgtl00c5mqnpjm5p8aud9cqldgwf3rq8dxvgy4snhadga"
);

receiver instanceof address.BaseAddress; // true
receiver.getHex(); // "015bb58d4a68..."
receiver.paymentCredential.hash; // Uint8Array(28)
receiver.stakeCredential.hash; // Uint8Array(28)
```

To create your wallet's own addresses, derive its keys with [@stricahq/bip32ed25519](https://github.com/StricaHQ/bip32ed25519) v2 and put their hashes in credentials:

```js
import { Bip32PrivateKey } from "@stricahq/bip32ed25519";

const rootKey = await Bip32PrivateKey.fromEntropy(entropy);
const accountKey = rootKey.derivePath("m/1852'/1815'/0'");
const accountXpub = accountKey.toBip32PublicKey();

const HARDENED = 0x80000000;
const bipPath = (chain, index) => ({
  purpose: HARDENED + 1852,
  coin: HARDENED + 1815,
  account: HARDENED,
  chain,
  index,
});

const paymentCredential = {
  type: types.HashType.ADDRESS,
  hash: accountXpub.derivePath("0/0").toPublicKey().hash(),
  bipPath: bipPath(0, 0),
};
const stakeCredential = {
  type: types.HashType.ADDRESS,
  hash: accountXpub.derivePath("2/0").toPublicKey().hash(),
  bipPath: bipPath(2, 0),
};

const myAddress = new address.BaseAddress(
  types.NetworkId.MAINNET,
  paymentCredential,
  stakeCredential
);
myAddress.getBech32(); // "addr1q..."

const rewardAddress = new address.RewardAddress(types.NetworkId.MAINNET, stakeCredential);
rewardAddress.getBech32(); // "stake1u..."
```

## Transactions

A transaction needs the current protocol parameters:

```js
const protocolParams = {
  minFeeA: 44n,
  minFeeB: 155381n,
  stakeKeyDeposit: 2000000n,
  utxoCostPerByte: 4310n,
  maxValueSize: 5000,

  // the rest are optional
  maxTxSize: 16384,
  // for reference scripts
  minFeeRefScriptCostPerByte: 15,
  // for Plutus scripts
  collateralPercent: 150,
  priceMem: 0.0577,
  priceSteps: 0.0000721,
  languageView: { PlutusScriptV3: [/* cost model */] },
};
```

`paymentTransaction` sends ADA and tokens from a list of UTxOs:

```js
import { Transaction } from "@stricahq/typhonjs";

const utxos = [
  {
    txId: "d771da555feac5b6376652b284c20b39f7b5aef8ea8e03c927f7f731fed13314",
    index: 0,
    amount: 50000000n,
    tokens: [],
    address: myAddress,
  },
];

const tx = new Transaction({ protocolParams }).paymentTransaction({
  inputs: utxos,
  outputs: [{ address: receiver, amount: 5000000n, tokens: [] }],
  changeAddress: myAddress,
  ttl: currentSlot + 7200,
});

tx.getFee(); // bigint
```

Amounts are `bigint` lovelace. A token is `{ policyId, assetName, amount }`, with the policy id and asset name in hex.

For anything else, start from an empty `Transaction`, add what it should do, and call `prepareTransaction`:

```js
const tx = new Transaction({ protocolParams });

tx.addOutput({ address: receiver, amount: 5000000n, tokens: [] });
tx.setAuxiliaryData({ metadata: [{ label: 674, data: { msg: ["Thanks for dinner"] } }] });
tx.setTTL(currentSlot + 7200);

tx.prepareTransaction({ inputs: utxos, changeAddress: myAddress });
```

`prepareTransaction` spends UTxOs from `inputs`, in the order you give them, until they cover the outputs, deposits and fee. It sends the rest to `changeAddress` and sets the fee.

## Signing

`getRequiredWitnesses()` lists every key that has to sign, with the `bipPath` of its credential. Sign the transaction hash with each one:

```js
const txHash = tx.getTransactionHash();

for (const [, path] of tx.getRequiredWitnesses()) {
  const privateKey = accountKey.derive(path.chain).derive(path.index).toPrivateKey();
  tx.addWitness({
    publicKey: privateKey.toPublicKey().toBytes(),
    signature: privateKey.sign(txHash),
  });
}

const { hash, payload } = tx.buildTransaction();
```

`payload` is the signed transaction as CBOR hex, ready to submit, and `hash` is its id.

Keys that a native script or a required signer asks for are listed by `getRequiredNativeScriptWitnesses()` and `getRequiredSigners()`.

## Tokens

Mint with a native script policy:

```js
import { NativeScriptFactory } from "@stricahq/typhonjs";

const policy = new NativeScriptFactory({ pubKeyHash: utils.toHex(policyKeyHash) });
const policyId = utils.toHex(policy.policyId());
const assetName = utils.toHex(new TextEncoder().encode("TYPHON"));

tx.addMint({ policyId, assets: [{ assetName, amount: 1000n }], nativeScript: policy.json() });
tx.addOutput({
  address: receiver,
  amount: 2000000n,
  tokens: [{ policyId, assetName, amount: 1000n }],
});
```

A negative amount burns. For a Plutus policy, set `plutusScript` and a `redeemer` on the mint in place of `nativeScript`.

## Staking

```js
const { CertificateType, DRepType } = types;

// register the stake key and delegate to a pool
tx.addCertificate({
  type: CertificateType.STAKE_REG_DELEG,
  cert: {
    stakeCredential,
    poolKeyHash: utils.decodeBech32("pool1...").value,
    deposit: protocolParams.stakeKeyDeposit,
  },
});

// delegate voting power to a DRep
tx.addCertificate({
  type: CertificateType.VOTE_DELEGATION,
  cert: { stakeCredential, dRep: { type: DRepType.ADDRESS, key: dRepKeyHash } },
});

// withdraw rewards
tx.addWithdrawal({ rewardAccount: rewardAddress, amount: rewardBalance });
```

`types.CertificateType` has the other stake, DRep and committee certificates.

## Governance

A DRep key comes from the same account as the wallet's other keys:

```js
const dRepCredential = {
  type: types.HashType.ADDRESS,
  hash: accountXpub.derivePath("3/0").toPublicKey().hash(),
  bipPath: bipPath(3, 0),
};
```

Register it:

```js
tx.addCertificate({
  type: types.CertificateType.DREP_REG,
  cert: { dRepCredential, deposit: 500000000n, anchor: null },
});
```

Vote on a governance action:

```js
tx.addVotingProcedure({
  voter: { type: types.VoterType.DREP_KEY, key: dRepCredential },
  votes: [
    {
      govActionId: { txId: utils.fromHex(actionTxId), index: 0 },
      vote: types.VoteType.YES,
      anchor: null,
    },
  ],
});
```

`addProposalProcedure` submits a proposal, and `setDonationAmount` donates to the treasury.

## Plutus scripts

To lock funds at a script, send them to its address with a datum:

```js
const scriptAddress = utils.getAddressFromString("addr1w...");

tx.addOutput({
  address: scriptAddress,
  amount: 5000000n,
  tokens: [],
  plutusData: { constructor: 0, fields: [42n, utils.fromHex("cafe")] },
});
```

That's an inline datum. Set `plutusDataHash` instead for a datum hash. An output with `plutusScript` or `nativeScript` holds that script as a reference script.

To spend from the script, add the UTxO with a redeemer, and put the script on its address credential:

```js
const plutusScript = {
  cborHex: "59...",
  type: types.PlutusScriptType.PlutusScriptV3,
};

tx.addInput({
  txId: lockedTxId,
  index: 0,
  amount: 5000000n,
  tokens: [],
  address: new address.EnterpriseAddress(types.NetworkId.MAINNET, {
    type: types.HashType.SCRIPT,
    hash: scriptAddress.paymentCredential.hash,
    plutusScript,
  }),
  plutusData: datum, // leave out if the UTxO holds its datum inline
  redeemer: {
    plutusData: { constructor: 0, fields: [] },
    exUnits: { mem: 1000000, steps: 500000000 },
  },
});

tx.prepareTransaction({ inputs: utxos, changeAddress: myAddress, collateralInputs });
```

`collateralInputs` are UTxOs you keep for collateral.

A redeemer works the same way on a mint, certificate, withdrawal, vote or proposal that runs a Plutus script. When a reference input holds the script, leave it off the credential and add the reference input:

```js
tx.addReferenceInput({ txId: refTxId, index: 0, plutusScript });
```

Execution units come from evaluating the transaction. `getRedeemers()` lists every redeemer with the tag and index an evaluator reports its units by. Set the units on each `redeemer`, then call `prepareTransaction` again so the fee covers them:

```js
for (const { tag, index, redeemer } of tx.getRedeemers()) {
  redeemer.exUnits = evaluation[`${tag}:${index}`];
}

tx.prepareTransaction({ inputs: utxos, changeAddress: myAddress, collateralInputs });
```

## Utilities

| Helper | What it does |
|---|---|
| `utils.toHex`, `utils.fromHex` | bytes to hex and back |
| `utils.getAddressFromString`, `utils.getAddressFromHex` | an address object from bech32, base58, bytes or hex |
| `utils.decodeBech32` | the prefix and bytes of any bech32 string |
| `utils.calculateMinUtxoAmountBabbage` | the least ADA an output can hold |
| `PlutusDataFactory` | the CBOR and hash of a datum |
| `NativeScriptFactory` | the CBOR and policy id of a native script |
| `crypto.hash32`, `crypto.hash28` | Blake2b-256 and Blake2b-224 |

## API docs

The full API reference is at [docs.strica.io/lib/typhonjs](https://docs.strica.io/lib/typhonjs), and the [tests](./tests) have more examples.

## Used by

[Typhon Wallet](https://typhonwallet.io)

# License

Copyright 2022 Strica

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
