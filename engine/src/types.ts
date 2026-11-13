import type { Bundle, FilingStatus } from "../../dataset/schema.ts";

export type { Bundle, FilingStatus };

/** Dollars per year, or a percent of gross pay (10 means 10%). */
export type Amount = { kind: "dollars"; value: number } | { kind: "percent"; value: number };

export type Income =
  | { kind: "salary"; annual: number; hoursPerWeek?: number; weeksPerYear?: number }
  | {
      kind: "hourly";
      rate: number;
      hoursPerWeek: number;
      weeksPerYear: number;
      overtimeHoursPerWeek?: number;
      /** Pay multiple for overtime hours. Defaults to 1.5. */
      overtimeMultiplier?: number;
    };

/** "100% of the first 4% of pay" is { rate: 1, upToPercent: 4 }. Tiers stack. */
export interface MatchTier {
  rate: number;
  upToPercent: number;
}

export interface Profile {
  /** Two-letter code, including DC. */
  state: string;
  filingStatus: FilingStatus;
  age: number;
  dependents: {
    /** Children who qualify for the federal child tax credit (under 17). */
    children: number;
    other: number;
    /**
     * Each child's age at the end of the year, used for state credits that
     * depend on age. A child with no age given is taken to be DEFAULT_CHILD_AGE.
     */
    childAges?: number[];
  };
  income: Income;
  /** Bonus and any other taxable pay for the year. */
  bonus: number;
  contributions: {
    traditional401k: Amount;
    roth401k: Amount;
    traditionalIra: Amount;
    rothIra: Amount;
    hsa: Amount;
    hsaCoverage: "none" | "self" | "family";
    /** True when HSA money comes out of the paycheck, which also avoids Social Security and Medicare tax. */
    hsaViaPayroll: boolean;
    healthPremiums: Amount;
    fsa: Amount;
    commuter: Amount;
  };
  /** Whether a retirement plan at work covers the filer. Limits the traditional IRA deduction. */
  coveredByWorkplacePlan: boolean;
  employer: {
    match: MatchTier[];
    hsa: number;
    /** Any other employer-paid compensation to count toward total compensation. */
    other: number;
  };
}

export interface BracketSlice {
  from: number;
  /** Null for the top bracket. */
  to: number | null;
  rate: number;
  /** Taxable income that fell in this bracket. */
  income: number;
  tax: number;
}

export interface Breakdown {
  taxYear: number;
  gross: {
    regular: number;
    overtime: number;
    /** The part of overtime pay above the regular rate, which the federal overtime deduction covers. */
    overtimePremium: number;
    bonus: number;
    total: number;
  };
  contributions: {
    traditional401k: number;
    roth401k: number;
    traditionalIra: number;
    rothIra: number;
    hsa: number;
    healthPremiums: number;
    fsa: number;
    commuter: number;
    employeeTotal: number;
    employerMatch: number;
    employerHsa: number;
    employerOther: number;
  };
  federal: {
    /** Wages subject to income tax (W-2 box 1). */
    wages: number;
    agi: number;
    iraDeduction: number;
    /** The standard deduction available to this filer. */
    standardDeduction: number;
    /** The deduction actually taken: the standard deduction, or state income tax itemized when that is larger. */
    deduction: number;
    /** True when itemizing state income tax beat the standard deduction. */
    itemizes: boolean;
    overtimeDeduction: number;
    taxableIncome: number;
    slices: BracketSlice[];
    taxBeforeCredits: number;
    /** Child tax credit plus credit for other dependents, after phase-out. */
    dependentCredits: number;
    /** The child tax credit's share of `dependentCredits`, refundable part included. */
    childTaxCredit: number;
    /** The part of the credits for dependents paid out beyond the tax owed. */
    refundableCredit: number;
    /** Earned income credit. Refundable. */
    earnedIncomeCredit: number;
    /** Negative when refundable credits exceed the tax. */
    tax: number;
    /** Rate of the bracket the last dollar of taxable income fell in. */
    marginalRate: number;
  };
  fica: {
    wages: number;
    socialSecurity: number;
    medicare: number;
    additionalMedicare: number;
    total: number;
  };
  state: {
    code: string;
    name: string;
    hasIncomeTax: boolean;
    agi: number;
    standardDeduction: number;
    exemptionDeduction: number;
    /** Health premiums the state taxed, deducted as medical expenses where the state allows it. */
    medicalDeduction: number;
    /** Social Security and Medicare tax deducted from state income, where the state allows it. */
    payrollTaxDeduction: number;
    /** Federal income tax deducted from state income, where the state allows it. */
    federalTaxDeduction: number;
    taxableIncome: number;
    slices: BracketSlice[];
    bracketTax: number;
    surtax: number;
    /** Dollars added by income-keyed adjustments such as recapture. */
    adjustments: number;
    /** Tax removed by every credit: percentage credits, exemption credits and credits for children. */
    credits: number;
    /** The part of `credits` that comes from credits for children. */
    childCredits: number;
    /** The part of `credits` that comes from the state's earned income credit. */
    earnedIncomeCredit: number;
    /** The part of `credits` paid out beyond the tax owed. */
    refundableCredit: number;
    /** Negative when refundable credits exceed the tax. */
    tax: number;
    marginalRate: number;
    hasLocalIncomeTaxes: boolean;
    hasStatePayrollTax: boolean;
    /** Things about this state the numbers do not capture. */
    notes: string[];
  };
  totals: {
    /** Federal income tax, Social Security, Medicare and state income tax. */
    tax: number;
    employeeContributions: number;
    /** Gross pay minus tax minus everything the employee puts into accounts and premiums. */
    takeHome: number;
    /** Total tax as a share of gross pay. */
    effectiveRate: number;
    /** Gross pay plus employer match, employer HSA money and other employer-paid amounts. */
    totalCompensation: number;
  };
  warnings: string[];
}
