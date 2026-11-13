import type { Amount, Bundle, MatchTier, Profile } from "./types.ts";

type Federal = Bundle["federal"];

const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function resolve(amount: Amount, gross: number): number {
  const value = amount.kind === "percent" ? (gross * amount.value) / 100 : amount.value;
  return Math.max(0, value);
}

export interface PayrollContributions {
  traditional401k: number;
  roth401k: number;
  hsa: number;
  healthPremiums: number;
  fsa: number;
  commuter: number;
  warnings: string[];
}

/** Resolves paycheck contributions to yearly dollars and holds them to the legal limits. */
export function payrollContributions(
  profile: Profile,
  gross: number,
  federal: Federal,
): PayrollContributions {
  const { contributions: c, age } = profile;
  const limits = federal.contributionLimits;
  const warnings: string[] = [];

  let traditional401k = resolve(c.traditional401k, gross);
  let roth401k = resolve(c.roth401k, gross);
  const catchUp =
    age >= 60 && age <= 63 ? limits.k401.catchUp60to63 : age >= 50 ? limits.k401.catchUp50 : 0;
  const limit401k = limits.k401.employeeDeferral + catchUp;
  if (traditional401k + roth401k > limit401k) {
    const scale = limit401k / (traditional401k + roth401k);
    warnings.push(
      `401k contributions of ${dollars(traditional401k + roth401k)} are over the ${dollars(limit401k)} limit and were reduced to it.`,
    );
    traditional401k *= scale;
    roth401k *= scale;
  }

  let hsa = resolve(c.hsa, gross);
  if (c.hsaCoverage === "none") {
    if (hsa > 0 || profile.employer.hsa > 0) {
      warnings.push("HSA contributions need a high-deductible health plan. They were ignored.");
    }
    hsa = 0;
  } else {
    const base = c.hsaCoverage === "family" ? limits.hsa.family : limits.hsa.selfOnly;
    const limitHsa = base + (age >= 55 ? limits.hsa.catchUp55 : 0);
    const room = Math.max(0, limitHsa - profile.employer.hsa);
    if (profile.employer.hsa > limitHsa) {
      warnings.push(
        `The employer HSA contribution of ${dollars(profile.employer.hsa)} is over the ${dollars(limitHsa)} limit.`,
      );
    }
    if (hsa > room) {
      warnings.push(
        `HSA contributions are over the ${dollars(limitHsa)} limit (employer money counts toward it) and were reduced to ${dollars(room)}.`,
      );
      hsa = room;
    }
  }

  let fsa = resolve(c.fsa, gross);
  if (fsa > limits.healthFsa.limit) {
    warnings.push(`FSA contributions were reduced to the ${dollars(limits.healthFsa.limit)} limit.`);
    fsa = limits.healthFsa.limit;
  }

  let commuter = resolve(c.commuter, gross);
  const commuterLimit = 12 * (limits.commuter.monthlyTransit + limits.commuter.monthlyParking);
  if (commuter > commuterLimit) {
    warnings.push(`Commuter benefits were reduced to the ${dollars(commuterLimit)} yearly limit.`);
    commuter = commuterLimit;
  }

  return {
    traditional401k,
    roth401k,
    hsa,
    healthPremiums: resolve(c.healthPremiums, gross),
    fsa,
    commuter,
    warnings,
  };
}

/**
 * What remains of `full` across a phase-out range, using the IRS rounding for
 * IRA limits: up to the next $10, and never less than $200 until fully phased out.
 */
function phaseDown(full: number, magi: number, [start, end]: [number, number]): number {
  if (magi <= start) return full;
  if (magi >= end) return 0;
  const raw = (full * (end - magi)) / (end - start);
  return Math.min(full, Math.max(200, Math.ceil(raw / 10) * 10));
}

export interface IraContributions {
  traditionalIra: number;
  rothIra: number;
  /** The part of the traditional contribution that reduces taxable income. */
  deduction: number;
  warnings: string[];
}

/**
 * Applies the IRA limit, Roth income limits and the deduction phase-out.
 * `magi` is approximated as AGI before the IRA deduction.
 */
export function iraContributions(
  profile: Profile,
  gross: number,
  magi: number,
  federal: Federal,
): IraContributions {
  const { contributions: c, age, filingStatus } = profile;
  const ira = federal.contributionLimits.ira;
  const warnings: string[] = [];

  const limit = Math.min(ira.limit + (age >= 50 ? ira.catchUp50 : 0), gross);
  let traditionalIra = resolve(c.traditionalIra, gross);
  let rothIra = resolve(c.rothIra, gross);
  if (traditionalIra + rothIra > limit) {
    const scale = limit / (traditionalIra + rothIra);
    warnings.push(
      `IRA contributions of ${dollars(traditionalIra + rothIra)} are over the ${dollars(limit)} limit and were reduced to it.`,
    );
    traditionalIra *= scale;
    rothIra *= scale;
  }

  const rothAllowed = phaseDown(limit, magi, ira.rothPhaseOut[filingStatus]);
  if (rothIra > rothAllowed) {
    warnings.push(
      rothAllowed === 0
        ? "Income is too high to contribute to a Roth IRA directly. The Roth IRA contribution was ignored."
        : `Income limits reduce the Roth IRA contribution to ${dollars(rothAllowed)}.`,
    );
    rothIra = rothAllowed;
  }

  const deductible = profile.coveredByWorkplacePlan
    ? phaseDown(limit, magi, ira.traditionalDeductionPhaseOut.coveredByWorkplacePlan[filingStatus])
    : limit;
  const deduction = Math.min(traditionalIra, deductible);
  if (traditionalIra > deduction) {
    warnings.push(
      `Only ${dollars(deduction)} of the traditional IRA contribution is deductible at this income with a workplace plan.`,
    );
  }

  return { traditionalIra, rothIra, deduction, warnings };
}

/** Employer match in dollars for an employee contributing `contributed` out of `gross`. */
export function employerMatch(tiers: MatchTier[], contributed: number, gross: number): number {
  if (gross <= 0) return 0;
  const percent = (contributed / gross) * 100;
  let previous = 0;
  let matchedPercent = 0;
  for (const tier of [...tiers].sort((a, b) => a.upToPercent - b.upToPercent)) {
    matchedPercent += tier.rate * Math.max(0, Math.min(percent, tier.upToPercent) - previous);
    previous = tier.upToPercent;
  }
  return (matchedPercent / 100) * gross;
}
