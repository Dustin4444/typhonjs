import type { LanguageView, ProtocolParams } from "../../types";

// the optional protocol parameters that some transactions can't be built without
type FeatureParam = "minFeeRefScriptCostPerByte" | "collateralPercent" | "priceMem" | "priceSteps";

// a cost model is named by its language, as a transaction needs just the ones it runs
export type MissingParam = FeatureParam | `languageView.${keyof LanguageView}`;

const neededFor = (name: MissingParam): string =>
  name === "minFeeRefScriptCostPerByte" ? "reference scripts" : "Plutus scripts";

const joinNames = (names: Array<string>): string =>
  names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];

/**
 * An error naming the missing protocol parameters, grouped by what needs them.
 */
export const missingParamsError = (missing: Array<MissingParam>): Error => {
  const byUse = new Map<string, Array<string>>();
  for (const name of missing) {
    const use = neededFor(name);
    byUse.set(use, [...(byUse.get(use) ?? []), name]);
  }
  const uses = [...byUse].map(([use, names]) => `${joinNames(names)} for ${use}`);
  return new Error(`Missing protocolParams: ${uses.join("; ")}`);
};

export const requireParam = <K extends FeatureParam>(
  protocolParams: ProtocolParams,
  name: K
): NonNullable<ProtocolParams[K]> => {
  const value = protocolParams[name];
  if (value == null) {
    throw missingParamsError([name]);
  }
  return value;
};
