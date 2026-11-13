import { describe, expect, it } from "vitest";
import {
  applyChange,
  calculate,
  compareStates,
  marginalRate,
  perPeriod,
  taxCurve,
} from "../src/index.ts";
import type { Profile } from "../src/index.ts";
import { data, profile } from "./helpers.ts";

const hourly = (rate: number, overtimeHoursPerWeek = 0): Profile =>
  profile(0, {
    income: { kind: "hourly", rate, hoursPerWeek: 40, weeksPerYear: 52, overtimeHoursPerWeek },
  });

describe("perPeriod", () => {
  it("spreads a salary over each period", () => {
    const p = perPeriod(104_000, profile(104_000));
    expect(p.hourly).toBe(50);
    expect(p.daily).toBe(400);
    expect(p.weekly).toBe(2_000);
    expect(p.biweekly).toBe(4_000);
    expect(p.semimonthly).toBeCloseTo(4_333.33, 2);
    expect(p.monthly).toBeCloseTo(8_666.67, 2);
    expect(p.quarterly).toBe(26_000);
    expect(p.yearly).toBe(104_000);
  });

  it("uses the weeks an hourly worker actually works", () => {
    const worker = profile(0, {
      income: { kind: "hourly", rate: 25, hoursPerWeek: 30, weeksPerYear: 48 },
    });
    const p = perPeriod(36_000, worker);
    expect(p.hourly).toBe(25);
    expect(p.weekly).toBe(750);
    expect(p.daily).toBe(150);
  });
});

describe("applyChange", () => {
  it("raises a salary by percent, dollars a year, or dollars an hour", () => {
    const base = profile(100_000);
    const annual = (p: Profile) => (p.income.kind === "salary" ? p.income.annual : NaN);
    expect(annual(applyChange(base, { amount: 10, unit: "percent", per: "year" }))).toBeCloseTo(110_000, 6);
    expect(annual(applyChange(base, { amount: -5_000, unit: "dollars", per: "year" }))).toBe(95_000);
    expect(annual(applyChange(base, { amount: 1, unit: "dollars", per: "hour" }))).toBe(102_080);
  });

  it("raises an hourly rate, converting a yearly amount to an hourly one", () => {
    const rate = (p: Profile) => (p.income.kind === "hourly" ? p.income.rate : NaN);
    expect(rate(applyChange(hourly(30), { amount: 2, unit: "dollars", per: "hour" }))).toBe(32);
    expect(rate(applyChange(hourly(30), { amount: 10, unit: "percent", per: "year" }))).toBeCloseTo(33, 6);
    expect(rate(applyChange(hourly(30), { amount: 2_080, unit: "dollars", per: "year" }))).toBe(31);
  });

  it("makes a yearly raise add exactly that much gross pay when there is overtime", () => {
    const before = calculate(hourly(30, 5), data).gross.total;
    const raised = applyChange(hourly(30, 5), { amount: 5_000, unit: "dollars", per: "year" });
    expect(calculate(raised, data).gross.total).toBeCloseTo(before + 5_000, 2);
  });

  it("never drops pay below zero", () => {
    const cut = applyChange(profile(10_000), { amount: -50_000, unit: "dollars", per: "year" });
    expect(calculate(cut, data).gross.total).toBe(0);
  });
});

describe("marginalRate", () => {
  it("combines the federal bracket with payroll tax", () => {
    // 22% bracket plus 6.2% Social Security and 1.45% Medicare, in a state with no income tax.
    expect(marginalRate(profile(100_000), data)).toBeCloseTo(0.2965, 4);
  });

  it("includes state tax", () => {
    expect(marginalRate(profile(100_000, { state: "CA" }), data)).toBeCloseTo(0.2965 + 0.093, 4);
  });

  it("drops when Social Security stops", () => {
    // 24% bracket plus Medicare only.
    expect(marginalRate(profile(190_000), data)).toBeCloseTo(0.2545, 4);
  });
});

describe("compareStates", () => {
  it("covers every state and measures against the home state", () => {
    const rows = compareStates(profile(100_000, { state: "CA" }), data);
    expect(rows).toHaveLength(51);
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r]));
    expect(byCode.CA.takeHomeDifference).toBe(0);
    expect(byCode.TX.takeHomeDifference).toBe(4_910.86);
    expect(rows[0].stateTax).toBe(0);
    expect(rows.at(-1)!.takeHome).toBeLessThan(rows[0].takeHome);
  });
});

describe("taxCurve", () => {
  it("samples tax from zero to the maximum income", () => {
    const curve = taxCurve(profile(100_000), data, 300_000, 60);
    expect(curve).toHaveLength(61);
    expect(curve[0].gross).toBe(0);
    expect(curve.at(-1)!.gross).toBe(300_000);
    expect(curve[20]).toMatchObject({ gross: 100_000, federal: 13_170, fica: 7_650, state: 0 });
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].totalTax).toBeGreaterThanOrEqual(curve[i - 1].totalTax);
    }
  });
});
