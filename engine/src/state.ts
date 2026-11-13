import { scheduleValue } from "../../dataset/schedule.ts";
import { bracketTax } from "./brackets.ts";
import { meetsChildlessAge } from "./federal.ts";
import type { Breakdown, Bundle, Profile } from "./types.ts";

type State = Bundle["states"][string];

export interface StateInput {
  profile: Profile;
  state: State;
  federalWages: number;
  federalAgi: number;
  federalTaxableIncome: number;
  traditional401k: number;
  /** Employee HSA money taken from the paycheck. */
  hsaPayroll: number;
  /** Employee HSA money contributed directly and deducted on the federal return. */
  hsaDirect: number;
  employerHsa: number;
  /** Cafeteria-plan deductions taken out of the paycheck before federal tax. */
  healthPremiums: number;
  fsa: number;
  commuter: number;
  /** The traditional IRA deduction taken on the federal return. */
  iraDeduction: number;
  /** Federal income tax after credits, never below zero. */
  federalIncomeTax: number;
  /** The federal child tax credit the filer gets, refundable part included. */
  federalChildCredit: number;
  /** The federal earned income credit for this income and family, before the federal age test. */
  federalEarnedIncomeCredit: number;
  /** The ages the federal credit allows a filer with no qualifying child. */
  federalChildlessAges: { min: number; max: number };
  /** The most the federal credit pays a filer with no qualifying child. */
  federalChildlessMaximum: number;
  /** Social Security and Medicare tax the employee paid. */
  payrollTax: number;
}

/** The age assumed for a child whose age was not given. */
export const DEFAULT_CHILD_AGE = 10;

/** One age per child under 17, filling in the default where none was given. */
export function childAges(profile: Profile): number[] {
  const given = profile.dependents.childAges ?? [];
  return Array.from({ length: profile.dependents.children }, (_, i) => given[i] ?? DEFAULT_CHILD_AGE);
}

type Bracketed = Extract<State["incomeTax"], { type: "bracketed" }>;
type ChildCredit = Bracketed["childCredits"][number];
type CreditBasis = NonNullable<ChildCredit["incomeLimit"]>["basis"];

/** One credit for children, before it is set against the tax. See ChildCredit in the schema. */
function childCreditAmount(
  credit: ChildCredit,
  profile: Profile,
  income: (basis: CreditBasis) => number,
  federalChildCredit: number,
  stateEarnedIncomeCredit: number,
): number {
  const status = profile.filingStatus;
  const limit = credit.incomeLimit;
  if (limit && income(limit.basis) > limit[status]) return 0;

  // Dollars lost to the phase-out, either from each child's amount or from the total.
  let lost = 0;
  const phaseOut = credit.phaseOut;
  if (phaseOut) {
    const steps = Math.max(0, income(phaseOut.basis) - phaseOut.start[status]) / phaseOut.per;
    const counted =
      phaseOut.rounding === "up" ? Math.ceil(steps) : phaseOut.rounding === "down" ? Math.floor(steps) : steps;
    lost = counted * phaseOut.amount;
  }
  const lostEach = phaseOut?.appliesTo === "each" ? lost : 0;

  const byIncome = credit.amountByIncome;
  const fromIncome = byIncome
    ? scheduleValue(byIncome.points[status], "step", income(byIncome.basis))
    : undefined;
  const bandFor = (age: number) => credit.bands.find((b) => age >= b.fromAge && age < b.underAge);
  const qualifying = childAges(profile).filter(bandFor);
  let amounts = qualifying
    .map((age) => Math.max(0, (fromIncome ?? bandFor(age)!.amount) - lostEach))
    .filter((amount) => amount > 0)
    .sort((a, b) => b - a);
  if (credit.per === "return") amounts = amounts.slice(0, 1);
  else if (credit.maxChildren) amounts = amounts.slice(0, credit.maxChildren);

  const others = Math.max(0, (credit.perOtherDependent ?? 0) - lostEach) * profile.dependents.other;
  const addOn = credit.earnedIncomeAddOn;
  const earned =
    addOn && qualifying.length > 0 ? addOn.rate * Math.min(income("earned_income"), addOn.upTo) : 0;
  const total = amounts.reduce((sum, a) => sum + a, 0) + others + earned;
  const afterPhaseOut = phaseOut?.appliesTo === "total" ? Math.max(0, total - lost) : total;
  const ofEarnedIncomeCredit =
    qualifying.length > 0 ? (credit.earnedIncomeCreditShare ?? 0) * stateEarnedIncomeCredit : 0;
  return (
    afterPhaseOut + (credit.federalCreditShare ?? 0) * federalChildCredit + ofEarnedIncomeCredit
  );
}

/**
 * The state's earned income credit as two offers: a refundable amount and a
 * nonrefundable one. Most states have only one of them.
 */
function stateEarnedIncomeCredit(
  rule: NonNullable<Bracketed["earnedIncomeCredit"]>,
  input: StateInput,
): { refundable: number; nonrefundable: number } {
  const { profile } = input;
  const status = profile.filingStatus;
  const ages = childAges(profile);
  const n = Math.min(ages.length, 3);
  const federalAges = input.federalChildlessAges;
  const minAge = rule.childlessMinAge ?? federalAges.min;
  const maxAge = rule.childlessMaxAge === undefined ? federalAges.max : rule.childlessMaxAge;
  if (!meetsChildlessAge(profile, minAge, maxAge)) return { refundable: 0, nonrefundable: 0 };

  // The add-on goes only to filers who get the credit itself.
  const finish = (amount: number) =>
    Math.min(rule.cap ?? Infinity, amount + (n > 0 && amount > 0 ? (rule.withChildAddOn ?? 0) : 0));
  const onlyByStateAges = !meetsChildlessAge(profile, federalAges.min, federalAges.max);
  const federal =
    rule.widerAgesGetMaximum && onlyByStateAges && input.federalEarnedIncomeCredit > 0
      ? input.federalChildlessMaximum
      : input.federalEarnedIncomeCredit;
  const own = rule.schedule?.[n];
  const young = rule.youngChildMatch;
  const share =
    young && ages.some((age) => age < young.underAge) ? young.match : (rule.match?.[n] ?? 0);
  const main = finish(own ? scheduleValue(own[status], "linear", input.federalWages) : share * federal);
  const alternative = rule.nonrefundableMatch ? finish(rule.nonrefundableMatch[n] * federal) : 0;
  return rule.refundable
    ? { refundable: main, nonrefundable: alternative }
    : { refundable: 0, nonrefundable: main };
}

type Lookup = NonNullable<
  Extract<State["incomeTax"], { type: "bracketed" }>["federalTaxDeduction"]
>["share"];

export function stateTax(input: StateInput): Breakdown["state"] {
  const { profile, state } = input;
  const status = profile.filingStatus;
  const { rules } = state;
  const tax = state.incomeTax;

  const result: Breakdown["state"] = {
    code: state.jurisdiction,
    name: state.name,
    hasIncomeTax: tax.type !== "none",
    agi: 0,
    standardDeduction: 0,
    exemptionDeduction: 0,
    medicalDeduction: 0,
    payrollTaxDeduction: 0,
    federalTaxDeduction: 0,
    taxableIncome: 0,
    slices: [],
    bracketTax: 0,
    surtax: 0,
    adjustments: 0,
    credits: 0,
    childCredits: 0,
    earnedIncomeCredit: 0,
    refundableCredit: 0,
    tax: 0,
    marginalRate: 0,
    hasLocalIncomeTaxes: rules.hasLocalIncomeTaxes,
    hasStatePayrollTax: rules.hasStatePayrollTax,
    notes: rules.notes,
  };
  if (tax.type === "none") return result;

  // Income the state taxes that the federal return left out.
  const add401k = rules.taxes401kContributions ? input.traditional401k : 0;
  const addPayrollHsa = rules.taxesHsaContributions ? input.hsaPayroll + input.employerHsa : 0;
  const taxedPremiums = rules.taxesHealthPremiums ? input.healthPremiums : 0;
  const addCafeteria =
    taxedPremiums +
    (rules.taxesFsaContributions ? input.fsa : 0) +
    (rules.taxesCommuterBenefits ? input.commuter : 0);
  const addBack = add401k + addPayrollHsa + addCafeteria;
  // Deductions taken on the federal return that the state does not allow.
  const disallowed =
    (rules.taxesHsaContributions ? input.hsaDirect : 0) +
    (rules.taxesIraContributions ? input.iraDeduction : 0);

  // Federal AGI already has the direct HSA and IRA deductions taken off, so a
  // state that starts there adds back what it disallows. A state that defines
  // income itself starts from wages and subtracts only what it allows.
  const agi =
    tax.startingPoint === "state_gross_income"
      ? Math.max(0, input.federalWages + addBack - (input.hsaDirect + input.iraDeduction - disallowed))
      : input.federalAgi + addBack + disallowed;

  const incomeBefore =
    tax.startingPoint === "federal_taxable_income"
      ? input.federalTaxableIncome + addBack + disallowed
      : agi;

  const basisIncome = (basis: "federal_agi" | "state_agi" | "state_taxable_income", taxable: number) =>
    basis === "federal_agi" ? input.federalAgi : basis === "state_agi" ? agi : taxable;

  let standardDeduction = 0;
  const sd = tax.standardDeduction;
  if (sd) {
    standardDeduction = sd[status];
    if (sd.phaseOut) {
      const value = scheduleValue(
        sd.phaseOut.points[status],
        sd.phaseOut.interpolation,
        basisIncome(sd.phaseOut.basis, incomeBefore),
      );
      standardDeduction =
        sd.phaseOut.unit === "amount"
          ? value
          : sd.phaseOut.unit === "fraction"
            ? standardDeduction * value
            : Math.max(0, standardDeduction - value);
    }
  }

  let exemptionDeduction = 0;
  let exemptionCredit = 0;
  const pe = tax.personalExemption;
  if (pe) {
    const { children, other } = profile.dependents;
    let filer = pe[status];
    let perDependent = pe.dependent;
    let perOther = pe.otherDependent ?? (pe.dependentsCounted === "children" ? 0 : pe.dependent);
    const youngChildren = pe.youngChild
      ? childAges(profile).filter((age) => age < pe.youngChild!.underAge).length
      : 0;
    let perYoungChild = pe.youngChild?.amount ?? 0;
    let reduction = 0;

    if (pe.agiLimit && agi > pe.agiLimit[status]) {
      filer = 0;
      perDependent = 0;
      perOther = 0;
      perYoungChild = 0;
    }
    if (pe.phaseOut) {
      const { unit, appliesTo } = pe.phaseOut;
      const value = scheduleValue(
        pe.phaseOut.points[status],
        pe.phaseOut.interpolation,
        basisIncome(pe.phaseOut.basis, Math.max(0, incomeBefore - standardDeduction)),
      );
      const coversFiler = appliesTo !== "dependent";
      const coversDependents = appliesTo !== "filer";
      if (unit === "amount") {
        if (coversFiler) filer = Math.min(filer, value);
        else {
          perDependent = Math.min(perDependent, value);
          perOther = Math.min(perOther, value);
        }
      } else if (unit === "fraction") {
        if (coversFiler) filer *= value;
        if (coversDependents) {
          perDependent *= value;
          perOther *= value;
          perYoungChild *= value;
        }
      } else {
        reduction = value;
      }
    }

    const dependentKind = pe.dependentKind ?? pe.kind;
    const dependentTotal = perDependent * children + perOther * other + perYoungChild * youngChildren;
    exemptionDeduction =
      (pe.kind === "deduction" ? filer : 0) + (dependentKind === "deduction" ? dependentTotal : 0);
    exemptionCredit =
      (pe.kind === "credit" ? filer : 0) + (dependentKind === "credit" ? dependentTotal : 0);
    // A dollar reduction comes off the total, whichever form the exemption takes.
    if (exemptionCredit > 0) exemptionCredit = Math.max(0, exemptionCredit - reduction);
    else exemptionDeduction = Math.max(0, exemptionDeduction - reduction);
  }

  const lookup = (l: Lookup) =>
    scheduleValue(l.points[status], l.interpolation, basisIncome(l.basis, incomeBefore));

  // Payroll tax is either an itemized deduction that replaces the standard
  // deduction when it is larger, or a capped deduction on top of it.
  let payrollTaxDeduction = 0;
  const payroll = tax.payrollTaxDeduction;
  if (payroll) {
    const deductible = Math.min(input.payrollTax, payroll.capPerEarner ?? Infinity);
    if (payroll.mode === "additional") {
      payrollTaxDeduction = deductible;
    } else if (deductible > standardDeduction) {
      payrollTaxDeduction = deductible;
      standardDeduction = 0;
    }
  }

  // Premiums the state taxed are a medical expense, deductible above a share of income.
  const medicalDeduction = tax.medicalExpenseDeduction
    ? Math.max(0, taxedPremiums - tax.medicalExpenseDeduction.incomeFloor * agi)
    : 0;

  let federalTaxDeduction = 0;
  const federalRule = tax.federalTaxDeduction;
  if (federalRule) {
    federalTaxDeduction = Math.min(
      input.federalIncomeTax * lookup(federalRule.share),
      federalRule.cap ? lookup(federalRule.cap) : Infinity,
    );
  }

  const taxableIncome = Math.max(
    0,
    incomeBefore -
      standardDeduction -
      exemptionDeduction -
      medicalDeduction -
      payrollTaxDeduction -
      federalTaxDeduction,
  );
  const schedule = tax.brackets[status];
  const brackets = bracketTax(schedule, taxableIncome);

  const surtax = tax.surtaxes.reduce(
    (sum, s) => sum + s.rate * Math.max(0, taxableIncome - s.over[status]),
    0,
  );

  let adjustments = 0;
  let creditFraction = 0;
  for (const a of tax.taxAdjustments) {
    const value = scheduleValue(a.points[status], a.interpolation, basisIncome(a.basis, taxableIncome));
    if (a.effect === "add") adjustments += value;
    else creditFraction += value;
  }

  // Benefit recapture: above the top bracket's threshold of AGI everything is
  // taxed at the top rate. Below it, a fixed amount plus a share of the next
  // one, phased in over a range of AGI.
  const recapture = tax.benefitRecapture;
  if (recapture) {
    const top = schedule[schedule.length - 1];
    if (agi > top.from) {
      adjustments += Math.max(0, taxableIncome * top.rate - brackets.tax);
    } else {
      const levels = recapture.levels[status];
      const level = levels.findLast((l) => taxableIncome >= l.over) ?? levels[0];
      const bracketStart = schedule.findLast((b) => taxableIncome >= b.from)?.from ?? 0;
      const share = Math.min(
        1,
        Math.max(0, agi - Math.max(bracketStart, recapture.minAgi)) / recapture.phaseInLength,
      );
      adjustments += level.base + share * level.increment;
    }
  }

  const beforeCredits = brackets.tax + surtax + adjustments;
  const afterPercentCredit = beforeCredits * (1 - Math.min(1, creditFraction));
  const afterExemptionCredit = Math.max(0, afterPercentCredit - exemptionCredit);

  // Credits for children come last. Nonrefundable ones stop at zero tax,
  // refundable ones are paid out past it.
  const creditIncome = (basis: CreditBasis) =>
    basis === "earned_income" ? input.federalWages : basisIncome(basis, taxableIncome);
  // Where a state offers its earned income credit either way, take the one that leaves less tax.
  const offer = tax.earnedIncomeCredit
    ? stateEarnedIncomeCredit(tax.earnedIncomeCredit, input)
    : { refundable: 0, nonrefundable: 0 };
  const eicNonrefundable = Math.min(afterExemptionCredit, offer.nonrefundable);
  const takeRefundable = offer.refundable >= eicNonrefundable;
  const earnedIncomeCredit = takeRefundable ? offer.refundable : eicNonrefundable;
  const afterEarnedIncomeCredit = takeRefundable ? afterExemptionCredit : afterExemptionCredit - eicNonrefundable;

  let nonrefundable = 0;
  let refundable = takeRefundable ? offer.refundable : 0;
  for (const credit of tax.childCredits) {
    const amount = childCreditAmount(
      credit,
      profile,
      creditIncome,
      input.federalChildCredit,
      earnedIncomeCredit,
    );
    if (credit.refundable) refundable += amount;
    else nonrefundable += amount;
  }
  const usedNonrefundable = Math.min(afterEarnedIncomeCredit, nonrefundable);
  const finalTax = afterEarnedIncomeCredit - usedNonrefundable - refundable;

  return {
    ...result,
    agi,
    standardDeduction,
    exemptionDeduction,
    medicalDeduction,
    payrollTaxDeduction,
    federalTaxDeduction,
    taxableIncome,
    slices: brackets.slices,
    bracketTax: brackets.tax,
    surtax,
    adjustments,
    credits: beforeCredits - finalTax,
    childCredits: usedNonrefundable + refundable - (takeRefundable ? offer.refundable : 0),
    earnedIncomeCredit,
    refundableCredit: Math.max(0, -finalTax),
    tax: finalTax,
    marginalRate: brackets.marginalRate,
  };
}
