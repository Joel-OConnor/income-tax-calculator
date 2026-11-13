import { bracketTax } from "./brackets.ts";
import type { Breakdown, Bundle, Profile } from "./types.ts";

export interface FederalInput {
  profile: Profile;
  federal: Bundle["federal"];
  taxYear: number;
  /** Wages subject to income tax. */
  wages: number;
  agi: number;
  iraDeduction: number;
  overtimePremium: number;
  /** Gross pay, used for the refundable child tax credit. */
  earnedIncome: number;
  /** State income tax that could be itemized. Zero to force the standard deduction. */
  stateIncomeTax: number;
}

/**
 * The earned income credit before any age test: a share of earned income up to
 * a maximum, less a share of income over a threshold. Income for the phase-out
 * is AGI, or earned income when that is greater.
 */
export function earnedIncomeCredit(
  rule: Bundle["federal"]["credits"]["earnedIncomeCredit"],
  profile: Profile,
  earnedIncome: number,
  agi: number,
): number {
  const row = rule.byChildren[Math.min(profile.dependents.children, 3)];
  const start = row.phaseOutStart[profile.filingStatus === "mfj" ? "mfj" : "other"];
  const full = Math.min(row.maxCredit, row.phaseInRate * Math.max(0, earnedIncome));
  const lost = row.phaseOutRate * Math.max(0, Math.max(agi, earnedIncome) - start);
  return Math.max(0, Math.min(full, row.maxCredit - lost));
}

/** Whether a filer with no qualifying child is within the ages the credit allows. */
export function meetsChildlessAge(profile: Profile, minAge: number, maxAge: number | null): boolean {
  return (
    profile.dependents.children > 0 ||
    (profile.age >= minAge && (maxAge === null || profile.age <= maxAge))
  );
}

export function federalTax(input: FederalInput): Breakdown["federal"] {
  const { profile, federal, agi } = input;
  const status = profile.filingStatus;
  const { incomeTax, credits, deductions } = federal;

  const extra = incomeTax.additionalStandardDeduction;
  const standardDeduction =
    incomeTax.standardDeduction[status] +
    (profile.age >= 65 ? (status === "mfj" ? extra.married : extra.unmarried) : 0);

  // Deduction for the premium part of overtime pay. It shrinks by a fixed amount
  // for each full $1,000 of income over the threshold.
  let overtimeDeduction = 0;
  const ot = deductions.overtime;
  if (input.taxYear >= ot.firstTaxYear && input.taxYear <= ot.lastTaxYear) {
    const base = Math.min(input.overtimePremium, ot.max[status]);
    const over = Math.max(0, agi - ot.phaseOutStart[status]);
    overtimeDeduction = Math.max(0, base - Math.floor(over / 1000) * ot.reductionPer1000);
  }

  // Itemizing is limited to state income tax, which is capped. The cap shrinks
  // at high incomes but never below a floor.
  const salt = federal.itemized.stateAndLocalTax;
  const saltCap = Math.max(
    Math.min(salt.cap[status], salt.floor),
    salt.cap[status] - salt.phaseOutRate * Math.max(0, agi - salt.phaseOutStart[status]),
  );
  const itemized = Math.min(input.stateIncomeTax, saltCap);
  const itemizes = itemized > standardDeduction;
  const deduction = itemizes ? itemized : standardDeduction;

  const taxableIncome = Math.max(0, agi - deduction - overtimeDeduction);
  const { tax: taxBeforeCredits, slices, marginalRate } = bracketTax(
    incomeTax.brackets[status],
    taxableIncome,
  );

  // Child tax credit and the credit for other dependents share one phase-out:
  // a fixed amount lost for each $1,000, or part of $1,000, over the threshold.
  const { children, other } = profile.dependents;
  const childCredit = credits.childTaxCredit.perChild * children;
  const fullCredit = childCredit + credits.otherDependentCredit.perDependent * other;
  const phaseOut = credits.dependentCreditPhaseOut;
  const lost =
    Math.ceil(Math.max(0, agi - phaseOut.start[status]) / 1000) * phaseOut.reductionPer1000;
  const credit = Math.max(0, fullCredit - lost);

  // The credit first offsets tax. Part of what is left over from the child
  // credit can be refunded, limited by earned income and a per-child cap.
  const nonrefundable = Math.min(taxBeforeCredits, credit);
  const refundRule = credits.refundableChildTaxCredit;
  const refundableCredit = Math.min(
    credit - nonrefundable,
    Math.min(credit, childCredit),
    credits.childTaxCredit.refundableMax * children,
    refundRule.rate * Math.max(0, input.earnedIncome - refundRule.earnedIncomeOver),
  );

  const eic = credits.earnedIncomeCredit;
  const earnedIncomeCreditAmount = meetsChildlessAge(profile, eic.childlessMinAge, eic.childlessMaxAge)
    ? earnedIncomeCredit(eic, profile, input.wages, agi)
    : 0;

  return {
    wages: input.wages,
    agi,
    iraDeduction: input.iraDeduction,
    standardDeduction,
    deduction,
    itemizes,
    overtimeDeduction,
    taxableIncome,
    slices,
    taxBeforeCredits,
    dependentCredits: nonrefundable + refundableCredit,
    // The form does not split the nonrefundable credit between children and
    // other dependents, so it is shared out in proportion.
    childTaxCredit:
      (fullCredit > 0 ? (nonrefundable * childCredit) / fullCredit : 0) + refundableCredit,
    refundableCredit,
    earnedIncomeCredit: earnedIncomeCreditAmount,
    tax: taxBeforeCredits - nonrefundable - refundableCredit - earnedIncomeCreditAmount,
    marginalRate,
  };
}

export function ficaTax(
  wages: number,
  profile: Profile,
  fica: Bundle["federal"]["fica"],
): Breakdown["fica"] {
  const socialSecurity = fica.socialSecurity.rate * Math.min(wages, fica.socialSecurity.wageBase);
  const medicare = fica.medicare.rate * wages;
  const additionalMedicare =
    fica.additionalMedicare.rate *
    Math.max(0, wages - fica.additionalMedicare.threshold[profile.filingStatus]);
  return {
    wages,
    socialSecurity,
    medicare,
    additionalMedicare,
    total: socialSecurity + medicare + additionalMedicare,
  };
}
