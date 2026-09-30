import type { CardanoAddress, Input, Output, CollateralInput, Token } from "../../types";
import { maxAdaAmount } from "../../constants";
import { txInKey } from "../../utils/encoder";
import { getTokenDiff, getUniqueTokens } from "../../utils/helpers";
import { ceilDiv } from "../../utils/rational";
import {
  calculateMinUtxoAmountBabbage,
  getMaximumTokenSets,
  getOutputValueSize,
} from "../../utils/utils";
import type Transaction from "../Transaction";
import { requireParam } from "./protocolParams";

// leftover ADA below this goes to the fee when it can't make a change output of its own
const MAX_CHANGE_AS_FEE = 2000000n;

export function transactionBuilder({
  transaction,
  inputs,
  changeAddress,
  collateralInputs = [],
}: {
  transaction: Transaction;
  inputs: Array<Input>;
  changeAddress: CardanoAddress;
  collateralInputs?: Array<CollateralInput>;
}): Array<Output> {
  const { protocolParams } = transaction;

  const changeOutputs: Array<Output> = [];
  const addChange = (output: Output) => {
    transaction.addOutput(output);
    changeOutputs.push(output);
  };

  // minimum ADA of an output to the change address
  const changeMinUtxo = (tokens: Array<Token>): bigint =>
    calculateMinUtxoAmountBabbage(
      { address: changeAddress, amount: maxAdaAmount, tokens },
      protocolParams.utxoCostPerByte
    );

  const minUtxo = changeMinUtxo([]);

  // the least a failing script has to be able to take: the collateral percentage of the fee
  const requiredCollateral = (fee: bigint): bigint =>
    ceilDiv(fee * BigInt(requireParam(protocolParams, "collateralPercent")), 100n);

  const collateralValue = (): { ada: bigint; tokens: Array<Token> } => {
    let ada = 0n;
    const tokens: Array<Token> = [];
    for (const collateral of transaction.getCollaterals()) {
      ada += collateral.amount;
      tokens.push(...(collateral.tokens ?? []));
    }
    return { ada, tokens: getUniqueTokens(tokens) };
  };

  // A failing script can only take ADA, so the tokens of the collateral have to go back in the
  // collateral return, with enough ADA left for that output. Only a transaction that runs
  // Plutus scripts puts up collateral.
  const coversFee = (fee: bigint): boolean => {
    if (!transaction.isPlutusTransaction()) {
      return true;
    }
    if (transaction.getCollaterals().length === 0) {
      return false;
    }
    const { ada, tokens } = collateralValue();
    const required = requiredCollateral(fee);
    return tokens.length > 0 ? ada - required >= changeMinUtxo(tokens) : ada >= required;
  };

  // The fee with the collateral return and total collateral in the transaction. They're sized
  // with all of the collateral, which the final amounts never exceed. The return is left out
  // when the collateral holds no tokens and what the script wouldn't take is below minimum ADA.
  const collateralFee = (extraOutputs?: Array<Output>): bigint => {
    if (!transaction.isPlutusTransaction() || transaction.getCollaterals().length === 0) {
      return transaction.calculateFee(extraOutputs);
    }
    const { ada, tokens } = collateralValue();
    transaction.setTotalCollateral(ada);
    transaction.setCollateralOutput({ address: changeAddress, amount: ada, tokens });
    const fee = transaction.calculateFee(extraOutputs);
    if (tokens.length > 0 || ada - requiredCollateral(fee) >= minUtxo) {
      return fee;
    }
    transaction.setCollateralOutput(undefined);
    return transaction.calculateFee(extraOutputs);
  };

  const addedCollaterals = new Set(
    transaction.getCollaterals().map((collateral) => txInKey(collateral.txId, collateral.index))
  );
  const availableCollaterals = collateralInputs.filter(
    (collateral) => !addedCollaterals.has(txInKey(collateral.txId, collateral.index))
  );

  // Adds collateral inputs, from the end of the list, until they cover the fee, or `fixedFee`
  // when the fee is set to that. Each one makes the transaction bigger, so the fee it covers
  // can grow past it.
  const feeWithCollateral = (extraOutputs?: Array<Output>, fixedFee?: bigint): bigint => {
    let fee = collateralFee(extraOutputs);
    while (!coversFee(fixedFee ?? fee) && availableCollaterals.length > 0) {
      transaction.addCollateral(availableCollaterals.pop()!);
      fee = collateralFee(extraOutputs);
    }
    return fee;
  };

  // the collateral return and total collateral for the final fee
  const settleCollateral = (fee: bigint) => {
    if (!transaction.isPlutusTransaction()) {
      return;
    }
    if (!coversFee(fee)) {
      throw new Error("Not enough collateral supplied");
    }
    const { ada, tokens } = collateralValue();
    const required = requiredCollateral(fee);
    if (transaction.getCollateralOutput() && ada - required >= changeMinUtxo(tokens)) {
      if (getOutputValueSize(ada - required, tokens) > protocolParams.maxValueSize) {
        throw new Error("Tokens of the collateral don't fit in a collateral return");
      }
      transaction.setCollateralOutput({ address: changeAddress, amount: ada - required, tokens });
      transaction.setTotalCollateral(required);
    } else {
      transaction.setCollateralOutput(undefined);
      transaction.setTotalCollateral(ada);
    }
  };

  const seen = new Set<string>();
  const utxoInputs = inputs
    .filter((input) => {
      const key = txInKey(input.txId, input.index);
      if (seen.has(key) || transaction.hasInput(input)) return false;
      seen.add(key);
      return true;
    })
    .map((input) => ({ ...input, tokens: [...input.tokens] }));

  // Add Inputs
  // there needs to be min one input
  if (transaction.getInputs().length === 0) {
    const firstInput = utxoInputs.shift();
    if (!firstInput) {
      throw new Error("No inputs to spend");
    }
    transaction.addInput(firstInput);
  }

  for (const utxo of utxoInputs) {
    // optimized utxo selection
    const { ada: totalInputAda, tokens: totalInputTokens } = transaction.getInputAmount();
    const { ada: totalOutputAda, tokens: totalOutputTokens } = transaction.getOutputAmount();
    const additionalOutput = transaction.getAdditionalOutputAda();
    const additionalInput = transaction.getAdditionalInputAda();

    const trxFeeWithoutChange = feeWithCollateral();

    const currentInput = totalInputAda + additionalInput;
    const requiredInput = totalOutputAda + additionalOutput + trxFeeWithoutChange;

    const tokenDiff = getTokenDiff(totalInputTokens, totalOutputTokens);

    if (tokenDiff.length === 0) {
      if (currentInput === requiredInput) {
        // we got enough input
        break;
      } else if (currentInput > requiredInput) {
        // input diff without fee
        const inputDiff = currentInput - (totalOutputAda + additionalOutput);
        // not equal to, as there will be a fee above minUtxo
        if (inputDiff > minUtxo) {
          const changeOutput = { address: changeAddress, amount: inputDiff, tokens: [] };
          const feeWithChange = feeWithCollateral([changeOutput]);
          if (inputDiff >= feeWithChange + minUtxo) {
            // we got enough input
            break;
          }
        }
      }
    } else if (!tokenDiff.some(({ amount }) => amount < 0n)) {
      const tokensTokens = getMaximumTokenSets(tokenDiff, protocolParams.maxValueSize);
      const changeOutputs: Array<Output> = [];
      let inputDiff = currentInput - (totalOutputAda + additionalOutput);
      let extraAdaRequired = 0n;
      for (const [index, tokens] of tokensTokens.entries()) {
        const minUtxo = changeMinUtxo(tokens);
        let outputAmount = minUtxo;
        if (index === tokensTokens.length - 1) {
          // last set, add full ada diff as output
          const lastOutput = {
            address: changeAddress,
            amount: inputDiff < minUtxo ? minUtxo : inputDiff,
            tokens: tokens,
          };
          const feeWithChange = feeWithCollateral([...changeOutputs, lastOutput]);
          const minADA = minUtxo + feeWithChange;
          if (inputDiff >= minADA) {
            outputAmount = inputDiff;
          } else {
            extraAdaRequired += minADA - inputDiff;
          }
        } else if (inputDiff >= minUtxo) {
          inputDiff -= minUtxo;
        } else {
          extraAdaRequired += minUtxo - inputDiff;
        }
        changeOutputs.push({
          address: changeAddress,
          amount: outputAmount,
          tokens: tokens,
        });
      }
      if (extraAdaRequired === 0n) {
        // we got enough input
        break;
      }
    }
    transaction.addInput(utxo);
  }

  // Set Change
  const { ada: totalInputAda, tokens: totalInputTokens } = transaction.getInputAmount();
  const { ada: totalOutputAda, tokens: totalOutputTokens } = transaction.getOutputAmount();
  const additionalOutput = transaction.getAdditionalOutputAda();
  const additionalInput = transaction.getAdditionalInputAda();
  const currentInput = totalInputAda + additionalInput;
  const currentOutput = totalOutputAda + additionalOutput;
  const tokenDiff = getTokenDiff(totalInputTokens, totalOutputTokens);

  if (tokenDiff.length === 0) {
    const feeWithoutChange = feeWithCollateral();
    const outputWithFee = currentOutput + feeWithoutChange;
    if (currentInput === outputWithFee) {
      // no change required
      settleCollateral(feeWithoutChange);
      transaction.setFee(feeWithoutChange);
    } else if (currentInput > outputWithFee) {
      const changeADA = currentInput - currentOutput;
      const feeWithChange = feeWithCollateral([
        {
          address: changeAddress,
          amount: changeADA,
          tokens: [],
        },
      ]);
      if (changeADA - feeWithChange >= minUtxo) {
        settleCollateral(feeWithChange);
        transaction.setFee(feeWithChange);
        addChange({
          address: changeAddress,
          amount: changeADA - feeWithChange,
          tokens: [],
        });
      } else if (changeADA < MAX_CHANGE_AS_FEE) {
        // if change is less than 2 ADA
        // not enough ADA for a change, set remaining ADA as fee
        if (feeWithCollateral(undefined, changeADA) > changeADA) {
          throw new Error("Not enough ADA");
        }
        settleCollateral(changeADA);
        transaction.setFee(changeADA);
      } else {
        throw new Error("Not enough ADA");
      }
    } else {
      throw new Error("Not enough ADA");
    }
  } else if (!tokenDiff.some(({ amount }) => amount < 0n)) {
    const tokensTokens = getMaximumTokenSets(tokenDiff, protocolParams.maxValueSize);
    const changeOutputs: Array<Output> = [];
    {
      let changeADA = currentInput - currentOutput;
      tokensTokens.forEach((tokens, index) => {
        const minUtxo = changeMinUtxo(tokens);
        let outputAmount = minUtxo;
        if (index === tokensTokens.length - 1) {
          // last set, add full ada diff as output
          const feeWithChange = feeWithCollateral([
            ...changeOutputs,
            {
              address: changeAddress,
              amount: changeADA < minUtxo ? minUtxo : changeADA,
              tokens: tokens,
            },
          ]);
          const minADA = minUtxo + feeWithChange;
          if (changeADA >= minADA) {
            outputAmount = changeADA;
          } else {
            throw new Error("Not enough ADA");
          }
        } else if (changeADA >= minUtxo) {
          changeADA -= minUtxo;
        } else {
          throw new Error("Not enough ADA");
        }
        changeOutputs.push({
          address: changeAddress,
          amount: outputAmount,
          tokens: tokens,
        });
      });
    }
    const feeWithChange = feeWithCollateral(changeOutputs);
    settleCollateral(feeWithChange);
    transaction.setFee(feeWithChange);
    let changeADA = currentInput - currentOutput - feeWithChange;
    tokensTokens.forEach((tokens, index) => {
      const minUtxo = changeMinUtxo(tokens);
      let outputAmount = minUtxo;
      if (index === tokensTokens.length - 1) {
        // last set, add full ada diff as output
        outputAmount = changeADA;
      } else if (changeADA >= minUtxo) {
        changeADA -= minUtxo;
      }
      addChange({
        address: changeAddress,
        amount: outputAmount,
        tokens: tokens,
      });
    });
  } else {
    throw new Error("Not enough tokens");
  }

  const txSize = transaction.calculateTxSize();

  if (protocolParams.maxTxSize && txSize > protocolParams.maxTxSize) {
    throw new Error("Tx size limit reached, try spending lesser ADA/Tokens");
  }
  return changeOutputs;
}

export default transactionBuilder;
