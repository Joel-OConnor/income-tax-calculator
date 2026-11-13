// Expected values are worked by hand from the 2026 figures in IRS Rev. Proc. 2025-32
// and the 2026 retirement limits, unless a comment says otherwise.

import { describe, expect, it } from "vitest";
import { calculate } from "../src/index.ts";
import { data, pct, profile, usd } from "./helpers.ts";

describe("federal income tax", () => {
  it("taxes a single filer on $100,000", () => {
    const b = calculate(profile(100_000), data);
    expect(b.federal.standardDeduction).toBe(16_100);
    expect(b.federal.taxableIncome).toBe(83_900);
    // $5,800 on the first $50,400, then 22% of the next $33,500.
    expect(b.federal.tax).toBe(13_170);
    expect(b.federal.marginalRate).toBe(0.22);
    expect(b.state.tax).toBe(0);
    expect(b.totals.takeHome).toBe(100_000 - 13_170 - 7_650);
  });

  it("reproduces the cumulative tax printed in the IRS rate tables", () => {
    // Taxable income at the top threshold, plus that status's standard deduction.
    const single = calculate(profile(640_600 + 16_100), data);
    const joint = calculate(profile(768_700 + 32_200, { filingStatus: "mfj" }), data);
    const head = calculate(profile(640_600 + 24_150, { filingStatus: "hoh" }), data);
    expect(single.federal.taxBeforeCredits).toBe(192_979.25);
    expect(joint.federal.taxBeforeCredits).toBe(206_583.5);
    expect(head.federal.taxBeforeCredits).toBe(191_171);
  });

  it("splits tax across brackets", () => {
    const { slices } = calculate(profile(100_000), data).federal;
    expect(slices.map((s) => s.income)).toEqual([12_400, 38_000, 33_500, 0, 0, 0, 0]);
    expect(slices.map((s) => s.tax)).toEqual([1_240, 4_560, 7_370, 0, 0, 0, 0]);
  });

  it("adds the extra standard deduction at 65", () => {
    expect(calculate(profile(100_000, { age: 65 }), data).federal.standardDeduction).toBe(18_150);
    expect(
      calculate(profile(100_000, { age: 65, filingStatus: "mfj" }), data).federal.standardDeduction,
    ).toBe(33_850);
  });
});

describe("itemizing state income tax", () => {
  it("takes the standard deduction when state tax is smaller", () => {
    const b = calculate(profile(250_000), data);
    expect(b.federal.itemizes).toBe(false);
    expect(b.federal.deduction).toBe(16_100);
  });

  it("itemizes when state tax beats the standard deduction", () => {
    const b = calculate(profile(250_000, { state: "OR" }), data);
    expect(b.federal.itemizes).toBe(true);
    expect(b.federal.deduction).toBe(b.state.tax);
    expect(b.federal.taxableIncome).toBe(250_000 - b.state.tax);
    // PolicyEngine US 2.118.6 gives $49,190 for this household.
    expect(Math.round(b.federal.tax)).toBe(49_190);
  });

  it("caps the deduction, and shrinks the cap above $505,000", () => {
    // California tax on $450,000 is under the $40,400 cap, so all of it is deducted.
    const under = calculate(profile(450_000, { state: "CA" }), data);
    expect(under.federal.itemizes).toBe(true);
    expect(under.federal.deduction).toBe(under.state.tax);
    // At $600,000 the cap is $40,400 less 30% of $95,000, which is below the standard deduction.
    const over = calculate(profile(600_000, { state: "CA" }), data);
    expect(over.federal.itemizes).toBe(false);
    expect(over.federal.deduction).toBe(16_100);
  });

  it("settles when the state also deducts federal tax", () => {
    // Oregon deducts federal tax and federal tax deducts Oregon tax. The two must agree.
    const b = calculate(profile(126_000, { state: "OR" }), data);
    const again = calculate(profile(126_000, { state: "OR" }), data);
    expect(b.totals.tax).toBe(again.totals.tax);
    expect(b.state.federalTaxDeduction).toBe(Math.min(7_000, b.federal.tax));
  });
});

describe("Social Security and Medicare", () => {
  it("applies both to ordinary wages", () => {
    const { fica } = calculate(profile(100_000), data);
    expect(fica.socialSecurity).toBe(6_200);
    expect(fica.medicare).toBe(1_450);
    expect(fica.additionalMedicare).toBe(0);
  });

  it("stops Social Security at the wage base and adds Medicare surtax above $200,000", () => {
    const { fica } = calculate(profile(300_000), data);
    expect(fica.socialSecurity).toBe(11_439); // 6.2% of $184,500
    expect(fica.medicare).toBe(4_350);
    expect(fica.additionalMedicare).toBe(900); // 0.9% of $100,000
  });

  it("uses the $250,000 Medicare surtax threshold for joint filers", () => {
    const { fica } = calculate(profile(300_000, { filingStatus: "mfj" }), data);
    expect(fica.additionalMedicare).toBe(450);
  });
});

describe("paycheck contributions", () => {
  it("takes a traditional 401k out before income tax but not before payroll tax", () => {
    const b = calculate(profile(100_000, { contributions: { traditional401k: pct(10) } }), data);
    expect(b.contributions.traditional401k).toBe(10_000);
    expect(b.federal.wages).toBe(90_000);
    expect(b.fica.wages).toBe(100_000);
    expect(b.federal.tax).toBe(10_970); // $5,800 + 22% of $23,500
  });

  it("gives a Roth 401k no tax break", () => {
    const b = calculate(profile(100_000, { contributions: { roth401k: pct(10) } }), data);
    expect(b.federal.tax).toBe(13_170);
    expect(b.totals.takeHome).toBe(100_000 - 13_170 - 7_650 - 10_000);
  });

  it("takes health premiums and a payroll HSA out before every tax", () => {
    const b = calculate(
      profile(100_000, {
        contributions: { healthPremiums: usd(5_000), hsa: usd(3_000), hsaCoverage: "self" },
      }),
      data,
    );
    expect(b.fica.wages).toBe(92_000);
    expect(b.fica.socialSecurity).toBe(5_704);
    expect(b.federal.tax).toBe(11_410); // $5,800 + 22% of $25,500
  });

  it("deducts an HSA paid in directly from income tax only", () => {
    const b = calculate(
      profile(100_000, {
        contributions: { hsa: usd(3_000), hsaCoverage: "self", hsaViaPayroll: false },
      }),
      data,
    );
    expect(b.fica.wages).toBe(100_000);
    expect(b.federal.agi).toBe(97_000);
  });

  it("holds 401k contributions to the limit, with catch-ups by age", () => {
    const over = { contributions: { traditional401k: usd(40_000) } };
    const at35 = calculate(profile(200_000, over), data);
    expect(at35.contributions.traditional401k).toBe(24_500);
    expect(at35.warnings.join(" ")).toMatch(/401k/);
    expect(calculate(profile(200_000, { ...over, age: 50 }), data).contributions.traditional401k).toBe(32_500);
    expect(calculate(profile(200_000, { ...over, age: 61 }), data).contributions.traditional401k).toBe(35_750);
    expect(calculate(profile(200_000, { ...over, age: 64 }), data).contributions.traditional401k).toBe(32_500);
  });

  it("shares the 401k limit between traditional and Roth", () => {
    const b = calculate(
      profile(200_000, { contributions: { traditional401k: usd(24_500), roth401k: usd(24_500) } }),
      data,
    );
    expect(b.contributions.traditional401k).toBe(12_250);
    expect(b.contributions.roth401k).toBe(12_250);
  });

  it("counts employer HSA money toward the HSA limit", () => {
    const b = calculate(
      profile(100_000, {
        contributions: { hsa: usd(4_000), hsaCoverage: "self" },
        employer: { hsa: 1_000 },
      }),
      data,
    );
    expect(b.contributions.hsa).toBe(3_400); // $4,400 limit less $1,000 from the employer
    expect(b.warnings.join(" ")).toMatch(/HSA/);
  });

  it("allows the HSA catch-up at 55 and ignores an HSA without a qualifying plan", () => {
    const family = { hsa: usd(20_000), hsaCoverage: "family" as const };
    expect(calculate(profile(100_000, { age: 55, contributions: family }), data).contributions.hsa).toBe(9_750);
    const none = calculate(profile(100_000, { contributions: { hsa: usd(2_000) } }), data);
    expect(none.contributions.hsa).toBe(0);
    expect(none.warnings).toHaveLength(1);
  });

  it("caps FSA and commuter benefits", () => {
    const b = calculate(
      profile(100_000, { contributions: { fsa: usd(5_000), commuter: usd(10_000) } }),
      data,
    );
    expect(b.contributions.fsa).toBe(3_400);
    expect(b.contributions.commuter).toBe(8_160); // 12 months of $340 transit and $340 parking
  });
});

describe("IRAs", () => {
  it("deducts a traditional IRA in full below the phase-out", () => {
    const b = calculate(profile(60_000, { contributions: { traditionalIra: usd(7_500) } }), data);
    expect(b.federal.iraDeduction).toBe(7_500);
    expect(b.federal.agi).toBe(52_500);
    expect(b.federal.tax).toBe(4_120); // $1,240 + 12% of $24,000
    expect(b.fica.wages).toBe(60_000);
  });

  it("phases the deduction out for someone with a workplace plan", () => {
    const b = calculate(profile(86_000, { contributions: { traditionalIra: usd(7_500) } }), data);
    expect(b.federal.iraDeduction).toBe(3_750); // halfway through $81,000 to $91,000
    expect(b.contributions.traditionalIra).toBe(7_500);
    expect(b.warnings.join(" ")).toMatch(/deductible/);
  });

  it("keeps the full deduction without a workplace plan", () => {
    const b = calculate(
      profile(86_000, { coveredByWorkplacePlan: false, contributions: { traditionalIra: usd(7_500) } }),
      data,
    );
    expect(b.federal.iraDeduction).toBe(7_500);
  });

  it("limits Roth IRA contributions by income", () => {
    const roth = { contributions: { rothIra: usd(7_500) } };
    expect(calculate(profile(100_000, roth), data).contributions.rothIra).toBe(7_500);
    expect(calculate(profile(160_500, roth), data).contributions.rothIra).toBe(3_750);
    expect(calculate(profile(170_000, roth), data).contributions.rothIra).toBe(0);
  });

  it("applies the IRA limit and the age 50 catch-up across both kinds", () => {
    const both = { contributions: { traditionalIra: usd(6_000), rothIra: usd(6_000) } };
    const b = calculate(profile(60_000, both), data);
    expect(b.contributions.traditionalIra + b.contributions.rothIra).toBe(7_500);
    const older = calculate(profile(60_000, { ...both, age: 50 }), data);
    expect(older.contributions.traditionalIra + older.contributions.rothIra).toBe(8_600);
  });
});

describe("dependents", () => {
  it("applies the child tax credit against tax", () => {
    const b = calculate(profile(80_000, { filingStatus: "mfj", dependents: { children: 2 } }), data);
    expect(b.federal.taxBeforeCredits).toBe(5_240); // $2,480 + 12% of $23,000
    expect(b.federal.dependentCredits).toBe(4_400);
    expect(b.federal.tax).toBe(840);
  });

  it("refunds part of the child credit when there is no tax to offset", () => {
    const b = calculate(profile(20_000, { filingStatus: "hoh", dependents: { children: 2 } }), data);
    expect(b.federal.taxBeforeCredits).toBe(0);
    // Limited to 15% of earnings over $2,500, which is below the $1,700 per child cap.
    expect(b.federal.refundableCredit).toBe(2_625);
    // The earned income credit for two children is at its $7,316 maximum here.
    expect(b.federal.earnedIncomeCredit).toBe(7_316);
    expect(b.federal.tax).toBe(-9_941);
  });

  it("caps the refund at $1,700 per child", () => {
    const b = calculate(profile(30_000, { filingStatus: "hoh", dependents: { children: 1 } }), data);
    // Taxable income $5,850, tax $585, leaving $1,615 of credit unused.
    expect(b.federal.taxBeforeCredits).toBe(585);
    expect(b.federal.refundableCredit).toBe(1_615);
    const none = calculate(profile(24_000, { filingStatus: "hoh", dependents: { children: 1 } }), data);
    expect(none.federal.refundableCredit).toBe(1_700);
  });

  it("gives $500 for other dependents, not refundable", () => {
    const b = calculate(profile(100_000, { dependents: { other: 1 } }), data);
    expect(b.federal.tax).toBe(12_670);
    const low = calculate(profile(15_000, { dependents: { other: 1 } }), data);
    expect(low.federal.dependentCredits).toBe(0);
    expect(low.federal.tax).toBe(-low.federal.earnedIncomeCredit);
  });

  it("phases the credits out above $400,000 for joint filers", () => {
    const kids = { filingStatus: "mfj" as const, dependents: { children: 2 } };
    expect(calculate(profile(400_000, kids), data).federal.dependentCredits).toBe(4_400);
    expect(calculate(profile(400_001, kids), data).federal.dependentCredits).toBe(4_350);
    expect(calculate(profile(410_000, kids), data).federal.dependentCredits).toBe(3_900);
    expect(calculate(profile(500_000, kids), data).federal.dependentCredits).toBe(0);
  });
});

describe("hourly pay and overtime", () => {
  const hourly = (rate: number, overtimeHoursPerWeek: number) =>
    profile(0, {
      income: { kind: "hourly", rate, hoursPerWeek: 40, weeksPerYear: 52, overtimeHoursPerWeek },
    });

  it("builds gross pay from rate, hours and overtime", () => {
    const { gross } = calculate(hourly(30, 5), data);
    expect(gross.regular).toBe(62_400);
    expect(gross.overtime).toBe(11_700); // 260 hours at $45
    expect(gross.overtimePremium).toBe(3_900); // the extra $15 on each of those hours
    expect(gross.total).toBe(74_100);
  });

  it("deducts the overtime premium from taxable income but not from payroll tax", () => {
    const b = calculate(hourly(30, 5), data);
    expect(b.federal.overtimeDeduction).toBe(3_900);
    expect(b.federal.taxableIncome).toBe(54_100);
    expect(b.federal.tax).toBe(6_614); // $5,800 + 22% of $3,700
    expect(b.fica.wages).toBe(74_100);
  });

  it("shrinks the overtime deduction above $150,000", () => {
    // $145,600 regular plus $10,920 overtime. Premium $3,640. $6,520 over the threshold loses $600.
    expect(calculate(hourly(70, 2), data).federal.overtimeDeduction).toBe(3_040);
  });

  it("caps the overtime deduction at $12,500", () => {
    // 1,040 overtime hours with a $15 premium is $15,600, and income stays under $150,000.
    expect(calculate(hourly(30, 20), data).federal.overtimeDeduction).toBe(12_500);
  });
});

describe("totals", () => {
  it("computes a tiered employer match and total compensation", () => {
    const b = calculate(
      profile(100_000, {
        contributions: { traditional401k: pct(5) },
        employer: { match: [{ rate: 1, upToPercent: 4 }, { rate: 0.5, upToPercent: 6 }], other: 2_000 },
      }),
      data,
    );
    expect(b.contributions.employerMatch).toBe(4_500); // 4% in full, then half of the next 1%
    expect(b.totals.totalCompensation).toBe(106_500);
  });

  it("includes bonus in gross pay", () => {
    const b = calculate(profile(90_000, { bonus: 10_000 }), data);
    expect(b.gross.total).toBe(100_000);
    expect(b.federal.tax).toBe(13_170);
  });

  it("subtracts every employee contribution from take-home", () => {
    const b = calculate(
      profile(100_000, {
        contributions: {
          traditional401k: usd(6_000),
          rothIra: usd(2_000),
          healthPremiums: usd(3_000),
        },
      }),
      data,
    );
    expect(b.totals.employeeContributions).toBe(11_000);
    expect(b.totals.takeHome).toBeCloseTo(100_000 - b.totals.tax - 11_000, 2);
  });
});

// Figures are from the 2026 table in Rev. Proc. 2025-32, section 4.06.
describe("earned income credit", () => {
  const eic = (annual: number, overrides: Parameters<typeof profile>[1] = {}) =>
    calculate(profile(annual, overrides), data).federal.earnedIncomeCredit;
  const head = (children: number) => ({ filingStatus: "hoh" as const, dependents: { children } });
  const joint = (children: number) => ({ filingStatus: "mfj" as const, dependents: { children } });

  it("phases in with earnings up to the maximum", () => {
    expect(eic(10_000, head(1))).toBe(3_400); // 34%
    expect(eic(10_000, head(2))).toBe(4_000); // 40%
    expect(eic(10_000, head(3))).toBe(4_500); // 45%
    expect(eic(20_000, head(1))).toBe(4_427);
    expect(eic(20_000, head(2))).toBe(7_316);
    expect(eic(20_000, head(5))).toBe(8_231);
    expect(eic(8_680)).toBe(664);
  });

  it("phases out above the threshold and ends at the completed phaseout amount", () => {
    expect(eic(23_890, head(1))).toBe(4_427);
    expect(eic(33_890, head(1))).toBe(2_829); // less 15.98% of $10,000
    expect(eic(51_593, head(1))).toBeLessThan(1);
    expect(eic(51_600, head(1))).toBe(0);
    expect(eic(58_629, head(2))).toBeLessThan(1);
    expect(eic(62_974, head(3))).toBeLessThan(1);
    expect(eic(15_000)).toBe(347.29); // $664 less 7.65% of $4,140
    expect(eic(19_540)).toBeLessThan(1);
  });

  it("starts the phaseout later for joint filers", () => {
    expect(eic(31_160, joint(2))).toBe(7_316);
    expect(eic(40_000, joint(3))).toBe(6_369.3); // $8,231 less 21.06% of $8,840
    expect(eic(70_244, joint(3))).toBeLessThan(1);
    expect(eic(18_140, joint(0))).toBe(664);
    expect(eic(26_820, joint(0))).toBeLessThan(1);
  });

  it("needs a filer without children to be 25 to 64", () => {
    expect(eic(9_000, { age: 24 })).toBe(0);
    expect(eic(9_000, { age: 25 })).toBe(664);
    expect(eic(9_000, { age: 64 })).toBe(664);
    expect(eic(9_000, { age: 65 })).toBe(0);
    expect(eic(20_000, { age: 22, ...head(1) })).toBe(4_427);
  });

  it("counts wages after a traditional 401k as earned income", () => {
    // $30,000 less 10% leaves $27,000, which is $3,110 over the threshold.
    const b = calculate(
      profile(30_000, { ...head(1), contributions: { traditional401k: pct(10) } }),
      data,
    );
    expect(b.federal.earnedIncomeCredit).toBe(3_930.02);
  });

  it("is paid on top of the refundable child credit", () => {
    const b = calculate(profile(30_000, head(1)), data);
    expect(b.federal.tax).toBe(585 - 2_200 - b.federal.earnedIncomeCredit);
    expect(b.totals.takeHome).toBeGreaterThan(30_000 - b.fica.total);
  });
});
