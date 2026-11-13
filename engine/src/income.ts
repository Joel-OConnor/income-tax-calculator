import type { Breakdown, Income, Profile } from "./types.ts";

const DEFAULT_HOURS_PER_WEEK = 40;
const DEFAULT_WEEKS_PER_YEAR = 52;

export function weeksPerYear(income: Income): number {
  return income.weeksPerYear ?? DEFAULT_WEEKS_PER_YEAR;
}

/** Hours worked in a year, including overtime hours. */
export function hoursPerYear(income: Income): number {
  const weekly =
    (income.hoursPerWeek ?? DEFAULT_HOURS_PER_WEEK) +
    (income.kind === "hourly" ? (income.overtimeHoursPerWeek ?? 0) : 0);
  return weekly * weeksPerYear(income);
}

export function grossPay(profile: Profile): Breakdown["gross"] {
  const { income } = profile;
  const bonus = Math.max(0, profile.bonus);
  if (income.kind === "salary") {
    const regular = Math.max(0, income.annual);
    return { regular, overtime: 0, overtimePremium: 0, bonus, total: regular + bonus };
  }
  const rate = Math.max(0, income.rate);
  const weeks = income.weeksPerYear;
  const overtimeHours = (income.overtimeHoursPerWeek ?? 0) * weeks;
  const multiplier = income.overtimeMultiplier ?? 1.5;
  const regular = rate * income.hoursPerWeek * weeks;
  const overtime = rate * multiplier * overtimeHours;
  // Only the "half" of time-and-a-half that federal law requires qualifies for
  // the overtime deduction, even when the employer pays more.
  const overtimePremium = rate * Math.min(Math.max(multiplier - 1, 0), 0.5) * overtimeHours;
  return { regular, overtime, overtimePremium, bonus, total: regular + overtime + bonus };
}
