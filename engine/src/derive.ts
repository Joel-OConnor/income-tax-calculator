// Views built on top of calculate(): pay periods, raise scenarios, marginal
// rate, the same profile in every state, and the tax-versus-income curve.

import { calculate } from "./calculate.ts";
import { hoursPerYear, weeksPerYear } from "./income.ts";
import type { Breakdown, Bundle, Profile } from "./types.ts";

export interface Periods {
  hourly: number;
  daily: number;
  weekly: number;
  biweekly: number;
  semimonthly: number;
  monthly: number;
  quarterly: number;
  yearly: number;
}

/**
 * Spreads a yearly amount over each pay period. Hourly, daily and weekly use
 * the hours and weeks actually worked. The rest divide the calendar year.
 */
export function perPeriod(yearly: number, profile: Profile, daysPerWeek = 5): Periods {
  const weeks = weeksPerYear(profile.income);
  const hours = hoursPerYear(profile.income);
  return {
    hourly: hours > 0 ? yearly / hours : 0,
    daily: weeks > 0 ? yearly / (weeks * daysPerWeek) : 0,
    weekly: weeks > 0 ? yearly / weeks : 0,
    biweekly: yearly / 26,
    semimonthly: yearly / 24,
    monthly: yearly / 12,
    quarterly: yearly / 4,
    yearly,
  };
}

export interface PayChange {
  /** Positive for a raise, negative for a cut. A percent of 5 means 5%. */
  amount: number;
  unit: "dollars" | "percent";
  /** Whether a dollar amount is per year or per hour. Ignored for percent. */
  per: "year" | "hour";
}

/** The same profile with base pay raised or lowered. Bonus is left alone. */
export function applyChange(profile: Profile, change: PayChange): Profile {
  const { income } = profile;
  if (income.kind === "salary") {
    const delta =
      change.unit === "percent"
        ? (income.annual * change.amount) / 100
        : change.per === "hour"
          ? change.amount * hoursPerYear(income)
          : change.amount;
    return { ...profile, income: { ...income, annual: Math.max(0, income.annual + delta) } };
  }
  // For hourly pay a yearly dollar change is spread over paid hours, with
  // overtime hours weighted by their multiplier.
  const paidHours =
    (income.hoursPerWeek +
      (income.overtimeHoursPerWeek ?? 0) * (income.overtimeMultiplier ?? 1.5)) *
    income.weeksPerYear;
  const delta =
    change.unit === "percent"
      ? (income.rate * change.amount) / 100
      : change.per === "hour"
        ? change.amount
        : paidHours > 0
          ? change.amount / paidHours
          : 0;
  return { ...profile, income: { ...income, rate: Math.max(0, income.rate + delta) } };
}

/**
 * Share of the next dollars of pay that goes to tax, across federal, payroll
 * and state. Measured by adding `step` dollars of pay, so it reflects
 * phase-outs and credits as well as brackets.
 */
export function marginalRate(profile: Profile, data: Bundle, step = 100): number {
  const base = calculate(profile, data).totals.tax;
  const bumped = calculate({ ...profile, bonus: profile.bonus + step }, data).totals.tax;
  return (bumped - base) / step;
}

export interface StateComparison {
  code: string;
  name: string;
  stateTax: number;
  totalTax: number;
  takeHome: number;
  /** Take-home here minus take-home in the profile's own state. */
  takeHomeDifference: number;
  hasLocalIncomeTaxes: boolean;
  hasStatePayrollTax: boolean;
}

/** The same profile run through every state, sorted by take-home, highest first. */
export function compareStates(profile: Profile, data: Bundle): StateComparison[] {
  const home = calculate(profile, data).totals.takeHome;
  return Object.keys(data.states)
    .map((code) => {
      const b = calculate({ ...profile, state: code }, data);
      return {
        code,
        name: b.state.name,
        stateTax: b.state.tax,
        totalTax: b.totals.tax,
        takeHome: b.totals.takeHome,
        takeHomeDifference: Math.round((b.totals.takeHome - home) * 100) / 100,
        hasLocalIncomeTaxes: b.state.hasLocalIncomeTaxes,
        hasStatePayrollTax: b.state.hasStatePayrollTax,
      };
    })
    .sort((a, b) => b.takeHome - a.takeHome || a.code.localeCompare(b.code));
}

/** The profile with base pay set so that base pay for the year equals `basePay`. */
export function withBasePay(profile: Profile, basePay: number): Profile {
  const { income } = profile;
  if (income.kind === "salary") return { ...profile, income: { ...income, annual: basePay } };
  const paidHours =
    (income.hoursPerWeek +
      (income.overtimeHoursPerWeek ?? 0) * (income.overtimeMultiplier ?? 1.5)) *
    income.weeksPerYear;
  return { ...profile, income: { ...income, rate: paidHours > 0 ? basePay / paidHours : 0 } };
}

export interface CurvePoint {
  gross: number;
  federal: number;
  fica: number;
  state: number;
  totalTax: number;
  takeHome: number;
}

/**
 * Tax at evenly spaced incomes from 0 to `maxBasePay`, holding everything else
 * in the profile fixed. Percent contributions scale with pay.
 */
export function taxCurve(
  profile: Profile,
  data: Bundle,
  maxBasePay: number,
  points = 200,
): CurvePoint[] {
  return Array.from({ length: points + 1 }, (_, i) => {
    const b: Breakdown = calculate(withBasePay(profile, (maxBasePay * i) / points), data);
    return {
      gross: b.gross.total,
      federal: b.federal.tax,
      fica: b.fica.total,
      state: b.state.tax,
      totalTax: b.totals.tax,
      takeHome: b.totals.takeHome,
    };
  });
}
