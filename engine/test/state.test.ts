// Expected values are worked by hand from each state's 2026 rules as recorded
// in the dataset. The Connecticut cases are figures printed in the state's own
// tax tables.

import { describe, expect, it } from "vitest";
import { calculate } from "../src/index.ts";
import type { FilingStatus } from "../src/index.ts";
import { data, pct, profile, usd } from "./helpers.ts";

const stateOf = (annual: number, state: string, overrides: Parameters<typeof profile>[1] = {}) =>
  calculate(profile(annual, { state, ...overrides }), data).state;

/** The printed tax tables stop before the earned income credit, so add it back. */
const taxBeforeEarnedIncomeCredit = (s: ReturnType<typeof stateOf>) => s.tax + s.earnedIncomeCredit;

describe("states without a wage income tax", () => {
  it("are exactly the nine expected", () => {
    const none = Object.keys(data.states).filter((code) => stateOf(100_000, code).tax === 0);
    expect(none.sort()).toEqual(["AK", "FL", "NH", "NV", "SD", "TN", "TX", "WA", "WY"]);
  });
});

describe("California", () => {
  it("taxes a single filer on $100,000", () => {
    const s = stateOf(100_000, "CA");
    expect(s.standardDeduction).toBe(5_900);
    expect(s.taxableIncome).toBe(94_100);
    // $3,310.88 at $75,197 per the FTB schedule, plus 9.3% of $18,903, less the $158 exemption credit.
    expect(s.bracketTax).toBe(5_068.86);
    expect(s.tax).toBe(4_910.86);
  });

  it("reproduces the cumulative tax printed in the FTB schedules", () => {
    expect(stateOf(768_213 + 5_900, "CA").bracketTax).toBe(74_675.27);
    expect(stateOf(1_536_426 + 11_800, "CA", { filingStatus: "mfj" }).bracketTax).toBe(149_350.54);
    expect(stateOf(1_044_771 + 11_800, "CA", { filingStatus: "hoh" }).bracketTax).toBe(100_786.98);
  });

  it("adds the 1% mental health tax above $1,000,000 of taxable income", () => {
    expect(stateOf(1_205_900, "CA").surtax).toBe(2_000);
  });

  it("taxes HSA contributions, including the employer's", () => {
    const hsa = { contributions: { hsa: usd(3_000), hsaCoverage: "self" as const } };
    expect(stateOf(100_000, "CA", hsa).tax).toBe(4_910.86);
    expect(stateOf(100_000, "CA", { ...hsa, employer: { hsa: 1_000 } }).agi).toBe(101_000);
  });

  it("gives a larger credit for dependents", () => {
    const s = stateOf(100_000, "CA", { dependents: { children: 1, other: 1 } });
    expect(s.tax).toBe(3_928.86); // $4,910.86 less two $491 dependent credits
  });
});

describe("Pennsylvania and New Jersey define income themselves", () => {
  it("Pennsylvania taxes 401k contributions", () => {
    expect(stateOf(100_000, "PA", { contributions: { traditional401k: pct(10) } }).tax).toBe(3_070);
  });

  it("Pennsylvania gives no deduction for an IRA", () => {
    expect(stateOf(60_000, "PA", { contributions: { traditionalIra: usd(7_500) } }).tax).toBe(1_842);
  });

  it("New Jersey excludes 401k contributions but taxes HSA contributions", () => {
    const k401 = stateOf(100_000, "NJ", { contributions: { traditional401k: usd(10_000) } });
    expect(k401.agi).toBe(90_000);
    const hsa = stateOf(100_000, "NJ", { contributions: { hsa: usd(3_000), hsaCoverage: "self" } });
    expect(hsa.agi).toBe(100_000);
  });

  // TB-39(R) and TB-24(R): salary reductions for cafeteria and commuter plans are New Jersey wages.
  it("New Jersey taxes flexible spending and commuter money taken from pay", () => {
    const untouched = stateOf(100_000, "NJ").tax;
    expect(stateOf(100_000, "NJ", { contributions: { fsa: usd(2_000) } }).tax).toBe(untouched);
    expect(stateOf(100_000, "NJ", { contributions: { commuter: usd(3_000) } }).tax).toBe(untouched);
  });

  it("New Jersey taxes health premiums, then deducts the part over 2% of income", () => {
    const small = stateOf(100_000, "NJ", { contributions: { healthPremiums: usd(1_500) } });
    expect(small.medicalDeduction).toBe(0);
    expect(small.tax).toBe(stateOf(100_000, "NJ").tax);

    const large = stateOf(100_000, "NJ", { contributions: { healthPremiums: usd(4_000) } });
    expect(large.agi).toBe(100_000);
    expect(large.medicalDeduction).toBe(2_000);
    expect(large.tax).toBe(4_052.65); // PolicyEngine moves by the same $127.40
  });

  it("Pennsylvania taxes commuter benefits but not health premiums or flexible spending", () => {
    expect(stateOf(100_000, "PA", { contributions: { commuter: usd(3_000) } }).tax).toBe(3_070);
    const cafeteria = { healthPremiums: usd(4_000), fsa: usd(2_000) };
    expect(stateOf(100_000, "PA", { contributions: cafeteria }).tax).toBe(2_885.8);
  });

  it("Pennsylvania deducts an HSA contribution made outside payroll", () => {
    const direct = { hsa: usd(3_000), hsaCoverage: "self" as const, hsaViaPayroll: false };
    expect(stateOf(100_000, "PA", { contributions: direct }).agi).toBe(97_000);
  });
});

describe("Massachusetts", () => {
  it("gives no deduction for a traditional IRA", () => {
    const ira = { contributions: { traditionalIra: usd(5_000) }, coveredByWorkplacePlan: false };
    expect(stateOf(100_000, "MA", ira).tax).toBe(stateOf(100_000, "MA").tax);
    // A state that follows the federal deduction, for contrast.
    expect(stateOf(100_000, "IL", ira).agi).toBe(95_000);
  });

  it("still leaves 401k contributions untaxed", () => {
    expect(stateOf(100_000, "MA", { contributions: { traditional401k: usd(10_000) } }).agi).toBe(90_000);
  });
});

describe("states that start from federal taxable income", () => {
  it("Colorado taxes it at a flat rate", () => {
    const s = stateOf(100_000, "CO");
    expect(s.taxableIncome).toBe(83_900);
    expect(s.tax).toBe(3_691.6);
  });
});

describe("Ohio", () => {
  it("charges nothing up to $26,050 of taxable income, then a lump sum", () => {
    // $28,450 of income less the $2,400 exemption is exactly $26,050.
    expect(stateOf(28_450, "OH").tax).toBe(0);
    expect(stateOf(28_451, "OH").tax).toBe(332.03);
  });

  it("steps the exemption down with income", () => {
    const s = stateOf(50_000, "OH");
    expect(s.exemptionDeduction).toBe(2_150);
    expect(s.tax).toBe(931.5); // $332 + 2.75% of $21,800
    expect(stateOf(90_000, "OH", { dependents: { children: 1 } }).exemptionDeduction).toBe(3_800);
  });
});

describe("Connecticut matches the state's printed tax tables", () => {
  // [filing status, Connecticut AGI at the middle of a table row, tax printed for that row]
  const rows: [FilingStatus, number, number][] = [
    ["single", 18_025, 15],
    ["single", 49_975, 1_799],
    ["single", 50_025, 1_801],
    ["single", 61_975, 2_546],
    ["mfj", 61_975, 1_655],
    ["hoh", 61_975, 2_150],
    ["mfj", 89_975, 3_194],
    ["mfj", 90_025, 3_196],
    ["single", 101_975, 5_119],
    ["mfj", 101_975, 4_159],
    ["hoh", 101_975, 4_649],
  ];
  it.each(rows)("%s at $%i owes $%i", (filingStatus, agi, expected) => {
    expect(Math.round(taxBeforeEarnedIncomeCredit(stateOf(agi, "CT", { filingStatus })))).toBe(expected);
  });

  it("adds recapture at high incomes", () => {
    const s = stateOf(150_000, "CT");
    expect(s.adjustments).toBe(475); // $250 add-back plus $225 recapture
    expect(s.tax).toBe(8_225);
  });
});

describe("income-based phase-outs", () => {
  it("Alabama steps its standard deduction down", () => {
    expect(stateOf(20_000, "AL").standardDeduction).toBe(3_000);
    expect(stateOf(30_250, "AL").standardDeduction).toBe(2_775);
  });

  it("Wisconsin slides its standard deduction", () => {
    const s = stateOf(80_000, "WI");
    expect(s.standardDeduction).toBe(6_774.4); // $13,960 less 12% of income over $20,120
    expect(s.tax).toBe(3_240.32);
    expect(stateOf(140_000, "WI").standardDeduction).toBe(0);
  });

  it("Maryland halves and then removes its exemption", () => {
    expect(stateOf(90_000, "MD").exemptionDeduction).toBe(3_200);
    expect(stateOf(110_000, "MD").exemptionDeduction).toBe(1_600);
    expect(stateOf(130_000, "MD").exemptionDeduction).toBe(800);
    expect(stateOf(160_000, "MD").exemptionDeduction).toBe(0);
  });

  it("Utah reduces its taxpayer credit by 1.3% of income over the threshold", () => {
    const s = stateOf(60_000, "UT");
    // 4.45% of $60,000, less a $966 credit that has lost $543.23.
    expect(s.tax).toBe(2_247.23);
    expect(stateOf(100_000, "UT").tax).toBe(4_450);
  });

  it("South Carolina phases its deduction out in a straight line", () => {
    expect(stateOf(40_000, "SC").standardDeduction).toBe(15_000);
    expect(stateOf(67_500, "SC").standardDeduction).toBe(7_500);
    expect(stateOf(95_000, "SC").standardDeduction).toBe(0);
  });

  it("Minnesota reduces its deduction at high incomes but never below 20%", () => {
    expect(stateOf(300_000, "MN").standardDeduction).toBe(13_632);
    expect(stateOf(2_000_000, "MN").standardDeduction).toBe(3_060);
  });

  it("North Carolina's child deduction counts children only and steps down", () => {
    const family = { filingStatus: "mfj" as const, dependents: { children: 1, other: 1 } };
    expect(stateOf(40_000, "NC", family).exemptionDeduction).toBe(3_000);
    expect(stateOf(80_000, "NC", family).exemptionDeduction).toBe(2_000);
    expect(stateOf(150_000, "NC", family).exemptionDeduction).toBe(0);
  });

  it("Oregon drops its exemption credit above the income limit", () => {
    const under = stateOf(100_000, "OR");
    const over = stateOf(100_001, "OR");
    expect(over.tax - under.tax).toBeGreaterThan(263);
  });
});

describe("surtaxes", () => {
  it("Massachusetts adds 4% above its indexed threshold", () => {
    // The $4,400 exemption and $2,000 payroll tax deduction put taxable income
    // exactly $200,000 over the $1,107,750 threshold.
    expect(stateOf(1_314_150, "MA").surtax).toBe(8_000);
  });
});

describe("states that deduct federal income tax", () => {
  it("Alabama deducts all of it, and payroll tax in place of the standard deduction", () => {
    const s = stateOf(75_000, "AL");
    expect(s.federalTaxDeduction).toBe(7_670);
    expect(s.payrollTaxDeduction).toBe(5_737.5);
    expect(s.standardDeduction).toBe(0);
    // $75,000 less $5,737.50, $7,670 and the $1,500 exemption, taxed at 2%, 4% and 5%.
    expect(s.taxableIncome).toBe(60_092.5);
    expect(s.tax).toBe(2_964.63);
  });

  it("Alabama keeps the standard deduction when it is the larger", () => {
    const s = stateOf(20_000, "AL");
    expect(s.standardDeduction).toBe(3_000);
    expect(s.payrollTaxDeduction).toBe(0);
  });

  it("Missouri deducts a share that falls as income rises", () => {
    expect(stateOf(40_000, "MO").federalTaxDeduction).toBe(655); // 25% of $2,620
    expect(stateOf(75_000, "MO").federalTaxDeduction).toBe(1_150.5); // 15% of $7,670
    expect(stateOf(130_000, "MO").federalTaxDeduction).toBe(0);
  });

  it("Oregon deducts it up to a cap that shrinks at higher incomes", () => {
    expect(stateOf(75_000, "OR").federalTaxDeduction).toBe(7_670);
    expect(stateOf(120_000, "OR").federalTaxDeduction).toBe(8_750);
    expect(stateOf(128_000, "OR").federalTaxDeduction).toBe(7_000);
    expect(stateOf(150_000, "OR").federalTaxDeduction).toBe(0);
    expect(stateOf(240_000, "OR", { filingStatus: "mfj" }).federalTaxDeduction).toBe(8_750);
  });
});

describe("other rules cross-checked with PolicyEngine", () => {
  // The dollar figures in this block are PolicyEngine US 2.118.6 results for the same household.
  it("Massachusetts deducts up to $2,000 of payroll tax", () => {
    const s = stateOf(75_000, "MA");
    expect(s.payrollTaxDeduction).toBe(2_000);
    expect(Math.round(s.tax)).toBe(3_430);
  });

  it("New York recaptures the benefit of its lower brackets", () => {
    expect(stateOf(100_000, "NY").adjustments).toBe(0);
    // $567, plus 69.2% of the next $2,047 for being $34,600 into a $50,000 phase-in.
    expect(Math.round(stateOf(250_000, "NY").adjustments)).toBe(1_984);
    expect(Math.round(stateOf(250_000, "NY").tax)).toBe(15_946);
    expect(Math.round(stateOf(300_000, "NY", { filingStatus: "mfj" }).tax)).toBe(16_753);
  });

  it("Colorado adds back the federal deduction from $300,000", () => {
    const joint = { filingStatus: "mfj" as const };
    expect(stateOf(299_999, "CO", joint).adjustments).toBe(0);
    expect(stateOf(300_000, "CO", joint).adjustments).toBe(1_328.8);
    expect(Math.round(stateOf(300_000, "CO", joint).tax)).toBe(13_112);
  });
});

describe("credits and deductions for children", () => {
  const kids = (ages: number[], other = 0) => ({ children: ages.length, other, childAges: ages });
  const joint = "mfj" as const;
  const head = "hoh" as const;

  it("assumes a child is 10 when no age is given", () => {
    const noAges = { filingStatus: joint, dependents: { children: 1 } };
    expect(stateOf(90_000, "MA", noAges).childCredits).toBe(440); // under 13
    expect(stateOf(90_000, "GA", noAges).childCredits).toBe(0); // not under 6
  });

  it("Georgia gives $250 per child under 6, never past zero tax", () => {
    const older = stateOf(90_000, "GA", { filingStatus: joint, dependents: kids([9, 9]) });
    const younger = stateOf(90_000, "GA", { filingStatus: joint, dependents: kids([3, 9]) });
    expect(younger.childCredits).toBe(250);
    expect(older.tax - younger.tax).toBe(250);
    expect(stateOf(90_000, "GA", { filingStatus: joint, dependents: kids([6]) }).childCredits).toBe(0);

    const low = stateOf(21_000, "GA", { filingStatus: head, dependents: kids([2]) });
    const lowOlder = stateOf(21_000, "GA", { filingStatus: head, dependents: kids([10]) });
    expect(lowOlder.tax).toBeGreaterThan(0);
    expect(lowOlder.tax).toBeLessThan(250);
    expect(low.tax).toBe(0);
    expect(low.childCredits).toBe(lowOlder.tax);
    expect(low.refundableCredit).toBe(0);
  });

  it("New York pays $1,000 under 4 and $500 from 4 to 16, less $16.50 per whole $1,000 over the limit", () => {
    const at = (annual: number, ages: number[]) =>
      stateOf(annual, "NY", { filingStatus: joint, dependents: kids(ages) }).childCredits;
    expect(at(100_000, [3, 9])).toBe(1_500);
    expect(at(100_000, [4])).toBe(500);
    expect(at(200_000, [3, 9])).toBe(15); // $1,500 less 90 x $16.50
    expect(at(200_999, [3, 9])).toBe(15); // a part of $1,000 does not count
    expect(at(201_000, [3, 9])).toBe(0);
    // Single and head of household filers start losing it at $75,000.
    expect(stateOf(85_000, "NY", { filingStatus: head, dependents: kids([2]) }).childCredits).toBe(835);
  });

  it("New York's credit is paid out past zero tax", () => {
    const s = stateOf(12_000, "NY", { filingStatus: head, dependents: kids([2, 3]) });
    expect(s.childCredits).toBe(2_000);
    // 30% of the federal earned income credit, which is 40% of $12,000 here.
    expect(s.earnedIncomeCredit).toBe(1_440);
    expect(s.tax).toBe(-3_440);
    expect(s.refundableCredit).toBe(3_440);
  });

  it("Vermont takes $20 off each child's $1,000 per $1,000, or part, of AGI over $125,000", () => {
    const at = (annual: number, ages: number[]) =>
      stateOf(annual, "VT", { filingStatus: joint, dependents: kids(ages) }).childCredits;
    expect(at(125_000, [6])).toBe(1_000);
    expect(at(125_000, [7])).toBe(0);
    expect(at(140_000, [6])).toBe(700);
    expect(at(140_001, [2, 6])).toBe(1_360);
    expect(at(174_001, [2])).toBe(0);
  });

  it("New Jersey steps its credit down with taxable income", () => {
    // $60,000 of wages less the $1,000 exemption and $1,500 for the child is $57,500.
    const s = stateOf(60_000, "NJ", { filingStatus: head, dependents: kids([5]) });
    expect(s.taxableIncome).toBe(57_500);
    expect(s.childCredits).toBe(500);
    expect(stateOf(60_000, "NJ", { filingStatus: head, dependents: kids([6]) }).childCredits).toBe(0);
    expect(stateOf(32_500, "NJ", { filingStatus: head, dependents: kids([5]) }).childCredits).toBe(1_250);
    expect(stateOf(32_501, "NJ", { filingStatus: head, dependents: kids([5]) }).childCredits).toBe(1_000);
    expect(stateOf(90_000, "NJ", { filingStatus: head, dependents: kids([5]) }).childCredits).toBe(0);
  });

  it("New Mexico's credit falls in steps with federal AGI and is refundable", () => {
    const at = (annual: number) =>
      stateOf(annual, "NM", { filingStatus: joint, dependents: kids([8, 15]) }).childCredits;
    expect(at(25_000)).toBe(1_274);
    expect(at(25_001)).toBe(848);
    expect(at(120_000)).toBe(158);
    expect(at(400_000)).toBe(52);
    expect(stateOf(15_000, "NM", { filingStatus: head, dependents: kids([8]) }).tax).toBeLessThan(0);
  });

  it("Colorado's credit for children under 6 follows the federal AGI tiers", () => {
    const at = (annual: number, filingStatus: FilingStatus, ages: number[]) =>
      stateOf(annual, "CO", { filingStatus, dependents: kids(ages) }).childCredits;
    expect(at(26_000, "hoh", [5])).toBe(1_200);
    expect(at(26_001, "hoh", [5])).toBe(600);
    expect(at(60_000, "hoh", [5, 2])).toBe(400);
    expect(at(61_000, "mfj", [5])).toBe(600);
    expect(at(87_001, "mfj", [5])).toBe(0);
    expect(at(26_000, "hoh", [6])).toBe(0);
  });

  it("Oklahoma gives 5% of the federal child tax credit up to $100,000 of AGI", () => {
    const perChild = data.federal.credits.childTaxCredit.perChild;
    const s = stateOf(60_000, "OK", { filingStatus: head, dependents: kids([8]) });
    expect(s.childCredits).toBe(0.05 * perChild);
    const two = stateOf(100_000, "OK", { filingStatus: joint, dependents: kids([8, 12], 1) });
    expect(two.childCredits).toBe(0.1 * perChild); // the other dependent's federal credit does not count
    expect(stateOf(100_001, "OK", { filingStatus: joint, dependents: kids([8, 12]) }).childCredits).toBe(0);
  });

  it("Utah gives $1,000 per child under 6, less 10 cents per dollar of income over the limit", () => {
    const at = (annual: number, ages: number[]) =>
      stateOf(annual, "UT", { filingStatus: joint, dependents: kids(ages) });
    expect(at(120_000, [3, 4]).childCredits).toBe(0); // $2,000 less 10% of $59,000
    expect(at(75_000, [3, 4]).childCredits).toBe(600);
    expect(at(75_000, [3, 4, 6]).childCredits).toBe(600); // a six-year-old does not count
    expect(at(40_000, [3]).tax).toBe(0); // not refundable
  });

  it("Maine doubles its dependent credit under 6 and phases the total out", () => {
    const base = stateOf(60_000, "ME", { filingStatus: head, dependents: kids([3, 9], 1) });
    expect(base.childCredits).toBe(1_220); // $610 + $305 + $305
    expect(base.exemptionDeduction).toBe(5_300);
    // $1,200 over the joint limit is three steps of $500, so $60 comes off.
    expect(stateOf(151_200, "ME", { filingStatus: joint, dependents: kids([3]) }).childCredits).toBe(550);
    expect(stateOf(170_000, "ME", { filingStatus: joint, dependents: kids([3]) }).childCredits).toBe(0);
  });

  it("Massachusetts gives $440 per child under 13", () => {
    expect(stateOf(90_000, "MA", { filingStatus: joint, dependents: kids([12, 13]) }).childCredits).toBe(440);
  });

  it("South Carolina doubles the dependent deduction for a child under 6", () => {
    const s = stateOf(90_000, "SC", { filingStatus: joint, dependents: kids([3, 9]) });
    expect(s.exemptionDeduction).toBe(15_120); // 3 x $5,040
  });

  it("California gives one young child credit per return, phased out over earned income", () => {
    const at = (annual: number, ages: number[]) =>
      stateOf(annual, "CA", { filingStatus: head, dependents: kids(ages) }).childCredits;
    expect(at(27_425, [2, 4])).toBe(1_189); // one credit however many children
    expect(at(30_000, [2])).toBe(629.97); // $1,189 less 25.75 x $21.71
    expect(at(32_901, [2])).toBe(0);
    expect(at(27_425, [6])).toBe(0);
  });

  it("Oregon gives $1,050 per child under 6, for up to five, phased out over $5,000", () => {
    const at = (annual: number, ages: number[]) =>
      stateOf(annual, "OR", { filingStatus: head, dependents: kids(ages) }).childCredits;
    expect(at(26_550, [1, 2, 3, 4, 5, 5])).toBe(5_250);
    expect(at(29_050, [1, 2])).toBe(1_050); // half of $2,100
    expect(at(31_550, [1])).toBe(0);
  });

  it("Minnesota phases its child and working family credits out together", () => {
    const at = (annual: number, filingStatus: FilingStatus, ages: number[]) =>
      stateOf(annual, "MN", { filingStatus, dependents: kids(ages) }).childCredits;
    expect(at(30_000, "hoh", [8])).toBe(2_187.6); // $1,800 plus 4% of $9,690
    expect(at(42_680, "hoh", [8])).toBe(987.6); // less 12% of $10,000
    expect(at(38_770, "mfj", [8, 16])).toBe(3_987.6);
    expect(at(80_000, "mfj", [8, 16])).toBe(0);
    expect(at(30_000, "hoh", [])).toBe(0); // no credit modeled without a child
  });

  it("Maryland takes $50 off each child's $500 per $1,000, or part, of AGI over $15,000", () => {
    const at = (annual: number, ages: number[]) =>
      stateOf(annual, "MD", { filingStatus: head, dependents: kids(ages) }).childCredits;
    expect(at(15_000, [2, 5])).toBe(1_000);
    expect(at(15_001, [2, 5])).toBe(900);
    expect(at(24_000, [2])).toBe(50);
    expect(at(24_001, [2])).toBe(0);
    expect(at(15_000, [6])).toBe(0);
  });

  it("Arizona gives $125 per child under 17 and $25 for other dependents", () => {
    const none = stateOf(100_000, "AZ", { filingStatus: joint });
    expect(none.tax - stateOf(100_000, "AZ", { filingStatus: joint, dependents: kids([8], 1) }).tax).toBe(150);
  });
});

describe("state earned income credits", () => {
  const kids = (ages: number[]) => ({ children: ages.length, other: 0, childAges: ages });
  const head = "hoh" as const;
  // A head of household on $20,000 with one child gets the federal maximum for one child.
  const oneChildMax = data.federal.credits.earnedIncomeCredit.byChildren[1].maxCredit;
  const twoChildMax = data.federal.credits.earnedIncomeCredit.byChildren[2].maxCredit;
  const family = (state: string, annual = 20_000, ages = [8]) =>
    stateOf(annual, state, { filingStatus: head, age: 30, dependents: kids(ages) });
  const alone = (state: string, annual: number, age = 30) => stateOf(annual, state, { age });

  it.each([
    ["CO", 0.25],
    ["HI", 0.4],
    ["IA", 0.15],
    ["IL", 0.2],
    ["IN", 0.1],
    ["KS", 0.17],
    ["LA", 0.05],
    ["MI", 0.3],
    ["NE", 0.1],
    ["MA", 0.4],
    ["MT", 0.2],
    ["NJ", 0.4],
    ["NM", 0.25],
    ["NY", 0.3],
    ["PA", 0.1],
    ["RI", 0.16],
    ["VA", 0.2],
    ["VT", 0.38],
  ])("%s gives %f of the federal credit to a family", (state, share) => {
    expect(family(state).earnedIncomeCredit).toBeCloseTo(share * oneChildMax, 2);
  });

  it("is paid out past zero tax where it is refundable", () => {
    const s = family("MA", 15_000);
    expect(s.tax).toBeLessThan(0);
    expect(s.refundableCredit).toBe(-s.tax);
  });

  it("gives nothing where the state has no credit", () => {
    expect(family("GA").earnedIncomeCredit).toBe(0);
    expect(family("TX").earnedIncomeCredit).toBe(0);
  });

  it("Connecticut adds $250 for a filer with a child", () => {
    expect(family("CT", 20_000, [2, 9]).earnedIncomeCredit).toBeCloseTo(0.4 * twoChildMax + 250, 2);
    expect(alone("CT", 9_000).earnedIncomeCredit).toBeCloseTo(0.4 * 664, 2);
    expect(family("CT", 60_000).earnedIncomeCredit).toBe(0); // no credit, so no add-on
  });

  it("Delaware takes the better of 4.5% refundable and 20% up to the tax", () => {
    // At $28,000 the federal credit is $4,427 less 15.98% of $4,110, and Delaware tax is more than 20% of it.
    expect(family("DE", 28_000).earnedIncomeCredit).toBeCloseTo(0.2 * 3_770.22, 1);
    expect(family("DE", 28_000).refundableCredit).toBe(0);
    // At $15,000 there is almost no tax, so the refundable 4.5% wins.
    const low = family("DE", 15_000);
    expect(low.earnedIncomeCredit).toBeCloseTo(0.045 * oneChildMax, 1);
    expect(low.tax).toBeLessThan(0);
  });

  it("Maryland gives 45% refundable or 50% against tax, and 100% without a child from any age", () => {
    expect(family("MD", 15_000).earnedIncomeCredit).toBeCloseTo(0.45 * oneChildMax, 2);
    expect(alone("MD", 12_000, 22).earnedIncomeCredit).toBe(576.79); // $664 less 7.65% of $1,140
    expect(alone("MD", 12_000, 65).earnedIncomeCredit).toBe(0);
  });

  it("Maine and Vermont give more to filers without children", () => {
    expect(alone("ME", 9_000).earnedIncomeCredit).toBe(332);
    expect(alone("ME", 9_000, 18).earnedIncomeCredit).toBe(332);
    expect(family("ME").earnedIncomeCredit).toBeCloseTo(0.25 * oneChildMax, 2);
    expect(alone("VT", 9_000).earnedIncomeCredit).toBe(664);
    expect(alone("VT", 9_000, 22).earnedIncomeCredit).toBe(0);
  });

  it("New Jersey pays 40% of the childless maximum to filers outside the federal ages", () => {
    expect(alone("NJ", 15_000, 30).earnedIncomeCredit).toBe(138.92); // 40% of $347.29
    expect(alone("NJ", 15_000, 22).earnedIncomeCredit).toBe(265.6); // 40% of $664
    expect(alone("NJ", 15_000, 70).earnedIncomeCredit).toBe(265.6);
    expect(alone("NJ", 15_000, 17).earnedIncomeCredit).toBe(0);
    expect(alone("NJ", 25_000, 22).earnedIncomeCredit).toBe(0); // over the federal income limit
  });

  it("Colorado and New Mexico let younger filers without children claim", () => {
    expect(alone("CO", 12_000, 22).earnedIncomeCredit).toBe(144.2); // 25% of $576.79
    expect(alone("CO", 12_000, 18).earnedIncomeCredit).toBe(0);
    expect(alone("NM", 12_000, 18).earnedIncomeCredit).toBe(144.2);
    expect(alone("HI", 12_000, 22).earnedIncomeCredit).toBe(0);
  });

  it("Oregon gives 17% with a child under 3 and 14% otherwise", () => {
    expect(family("OR", 20_000, [2, 9]).earnedIncomeCredit).toBeCloseTo(0.17 * twoChildMax, 2);
    expect(family("OR", 20_000, [3, 9]).earnedIncomeCredit).toBeCloseTo(0.14 * twoChildMax, 2);
  });

  it("Illinois adds a child credit of 40% of its earned income credit for a child under 12", () => {
    const young = family("IL", 20_000, [11]);
    expect(young.earnedIncomeCredit).toBeCloseTo(0.2 * oneChildMax, 2);
    expect(young.childCredits).toBeCloseTo(0.08 * oneChildMax, 2);
    expect(family("IL", 20_000, [12]).childCredits).toBe(0);
    expect(family("IL", 20_000, [3, 9]).childCredits).toBeCloseTo(0.08 * twoChildMax, 2); // once per return
    expect(alone("IL", 9_000, 19).earnedIncomeCredit).toBe(132.8); // from 18, no upper age
    expect(alone("IL", 9_000, 70).earnedIncomeCredit).toBe(132.8);
  });

  it("Wisconsin's share depends on the number of children", () => {
    expect(alone("WI", 9_000).earnedIncomeCredit).toBe(0);
    expect(family("WI").earnedIncomeCredit).toBeCloseTo(0.04 * oneChildMax, 2);
    expect(family("WI", 20_000, [2, 9]).earnedIncomeCredit).toBeCloseTo(0.11 * twoChildMax, 2);
    expect(family("WI", 20_000, [2, 9, 12]).earnedIncomeCredit).toBeCloseTo(0.34 * 8_231, 2);
  });

  it("Missouri, Ohio and South Carolina stop at zero tax", () => {
    for (const state of ["MO", "OH", "SC"]) {
      const s = family(state, 15_000);
      expect(s.tax).toBeGreaterThanOrEqual(0);
      expect(s.refundableCredit).toBe(0);
    }
    // At $45,000 the federal credit is $4,427 less 15.98% of $21,110, which is $1,053.62.
    expect(family("MO", 45_000).earnedIncomeCredit).toBeCloseTo(0.2 * 1_053.62, 1);
    expect(family("OH", 45_000).earnedIncomeCredit).toBeCloseTo(0.3 * 1_053.62, 1);
    expect(family("SC", 45_000).earnedIncomeCredit).toBe(200); // 125% of it, capped
  });

  it("Oklahoma uses 5% of the 2020 federal credit", () => {
    expect(family("OK", 15_000).earnedIncomeCredit).toBe(179.2); // 5% of $3,584
    expect(family("OK", 41_756).earnedIncomeCredit).toBe(0);
    expect(family("OK", 20_000, [2, 9]).earnedIncomeCredit).toBeCloseTo(0.05 * 5_920 * (27_440 / 28_110), 1);
    expect(alone("OK", 7_030).earnedIncomeCredit).toBe(26.9);
    expect(alone("OK", 15_820).earnedIncomeCredit).toBe(0);
  });

  it("Utah's credit stops at zero tax", () => {
    const s = family("UT", 45_000);
    expect(s.earnedIncomeCredit).toBeGreaterThan(0);
    expect(s.earnedIncomeCredit).toBeLessThanOrEqual(0.2 * oneChildMax);
    expect(family("UT", 15_000).tax).toBe(0);
    expect(family("UT", 15_000).refundableCredit).toBe(0);
  });

  it("DC gives 85% with a child and runs a longer phase-out without one", () => {
    expect(family("DC", 15_000).earnedIncomeCredit).toBeCloseTo(0.85 * oneChildMax, 2);
    expect(alone("DC", 22_000).earnedIncomeCredit).toBe(664); // the federal credit is gone by $19,540
    expect(alone("DC", 27_000).earnedIncomeCredit).toBeCloseTo(664 - 0.0848 * 3_712, 1);
    expect(alone("DC", 32_000).earnedIncomeCredit).toBe(0);
  });

  it("California follows its own schedule", () => {
    expect(family("CA", 6_998).earnedIncomeCredit).toBe(2_022.42); // 85% of 34%
    expect(family("CA", 15_000).earnedIncomeCredit).toBeCloseTo(538.44, 1); // second tier
    expect(family("CA", 9_823, [2, 9]).earnedIncomeCredit).toBe(3_339.82);
    expect(family("CA", 33_000).earnedIncomeCredit).toBe(0);
    expect(alone("CA", 4_661, 19).earnedIncomeCredit).toBe(303.08); // from 18, with no upper age
    expect(alone("CA", 9_000, 70).earnedIncomeCredit).toBeCloseTo(220, 0);
  });

  it("Minnesota pays its working family credit to filers without children aged 19 to 64", () => {
    expect(alone("MN", 15_000).earnedIncomeCredit).toBe(387.6); // 4% of $9,690
    expect(alone("MN", 5_000).earnedIncomeCredit).toBe(200);
    expect(alone("MN", 34_000).earnedIncomeCredit).toBe(229.2); // less 12% of $1,320
    expect(alone("MN", 15_000, 18).earnedIncomeCredit).toBe(0);
    // With a child it is counted inside the child credit instead.
    expect(family("MN").earnedIncomeCredit).toBe(0);
    expect(family("MN").childCredits).toBe(2_187.6);
  });
});

describe("every state", () => {
  const statuses: FilingStatus[] = ["single", "mfj", "hoh"];
  const incomes = [0, 15_000, 40_000, 75_000, 150_000, 400_000, 2_000_000];

  it.each(Object.keys(data.states))("%s gives sane results across incomes and statuses", (state) => {
    for (const filingStatus of statuses) {
      for (const annual of incomes) {
        const b = calculate(
          profile(annual, {
            state,
            filingStatus,
            dependents: { children: 2, other: 1 },
            contributions: { traditional401k: pct(6), hsa: usd(2_000), hsaCoverage: "family" },
          }),
          data,
        );
        expect(Number.isFinite(b.state.tax)).toBe(true);
        // Refundable credits can take state tax below zero.
        expect(b.state.tax).toBeGreaterThanOrEqual(-b.state.childCredits - b.state.earnedIncomeCredit - 0.005);
        expect(b.state.earnedIncomeCredit).toBeLessThanOrEqual(8_231);
        expect(b.state.childCredits).toBeLessThanOrEqual(4_000);
        expect(b.state.tax).toBeLessThanOrEqual(annual * 0.14);
        // Refundable credits can add to low incomes: up to $8,231 of federal earned
        // income credit, the refundable child credit, and state credits on top.
        expect(b.totals.takeHome).toBeLessThanOrEqual(annual + 20_000);
      }
    }
  });
});
