import { employerMatch, iraContributions, payrollContributions } from "./contributions.ts";
import { earnedIncomeCredit, federalTax, ficaTax } from "./federal.ts";
import { grossPay } from "./income.ts";
import { stateTax } from "./state.ts";
import type { Breakdown, Bundle, Profile } from "./types.ts";

/** Fields that hold a rate, not money, and must not be rounded to cents. */
const RATE_KEYS = new Set(["rate", "marginalRate", "effectiveRate"]);

function roundMoney<T>(value: T, key = ""): T {
  if (typeof value === "number") {
    return (RATE_KEYS.has(key) ? value : Math.round(value * 100) / 100) as T;
  }
  if (Array.isArray(value)) return value.map((v) => roundMoney(v, key)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, roundMoney(v, k)]),
    ) as T;
  }
  return value;
}

/**
 * The full yearly picture for one profile: gross pay, contributions, federal
 * income tax, Social Security and Medicare, state income tax, and take-home.
 * Pure: the same profile and data always give the same answer.
 */
export function calculate(profile: Profile, data: Bundle): Breakdown {
  const state = data.states[profile.state];
  if (!state) throw new Error(`No tax data for state "${profile.state}"`);
  const { federal, taxYear } = data;

  const gross = grossPay(profile);
  const payroll = payrollContributions(profile, gross.total, federal);
  const employerHsa = profile.contributions.hsaCoverage === "none" ? 0 : profile.employer.hsa;

  const hsaPayroll = profile.contributions.hsaViaPayroll ? payroll.hsa : 0;
  const hsaDirect = payroll.hsa - hsaPayroll;

  // Cafeteria-plan deductions come out before every tax. A traditional 401k
  // comes out before income tax only, so Social Security and Medicare still apply to it.
  const cafeteria = payroll.healthPremiums + payroll.fsa + payroll.commuter + hsaPayroll;
  const ficaWages = Math.max(0, gross.total - cafeteria);
  const federalWages = Math.max(0, ficaWages - payroll.traditional401k);

  const incomeBeforeIra = Math.max(0, federalWages - hsaDirect);
  const ira = iraContributions(profile, gross.total, incomeBeforeIra, federal);
  const agi = Math.max(0, incomeBeforeIra - ira.deduction);

  const fica = ficaTax(ficaWages, profile, federal.fica);
  const eic = federal.credits.earnedIncomeCredit;
  const federalFor = (stateIncomeTax: number) =>
    federalTax({
      profile,
      federal,
      taxYear,
      wages: federalWages,
      agi,
      iraDeduction: ira.deduction,
      overtimePremium: gross.overtimePremium,
      earnedIncome: gross.total,
      stateIncomeTax,
    });
  // States that start from federal taxable income make itemizers add their
  // state tax deduction back, which lands on the standard deduction figure.
  const standardFederal = federalFor(0);
  const stateFor = (f: Breakdown["federal"]) =>
    stateTax({
      profile,
      state,
      federalWages,
      federalAgi: agi,
      federalTaxableIncome: standardFederal.taxableIncome,
      traditional401k: payroll.traditional401k,
      hsaPayroll,
      hsaDirect,
      employerHsa,
      healthPremiums: payroll.healthPremiums,
      fsa: payroll.fsa,
      commuter: payroll.commuter,
      iraDeduction: ira.deduction,
      federalIncomeTax: Math.max(0, f.taxBeforeCredits - (f.dependentCredits - f.refundableCredit)),
      federalChildCredit: f.childTaxCredit,
      federalEarnedIncomeCredit: earnedIncomeCredit(eic, profile, federalWages, agi),
      federalChildlessAges: { min: eic.childlessMinAge, max: eic.childlessMaxAge },
      federalChildlessMaximum: eic.byChildren[0].maxCredit,
      payrollTax: fica.total,
    });

  // Federal tax can depend on state tax (itemizing) and state tax on federal
  // tax (states that deduct it), so the two are solved together. A few passes
  // settle to the cent.
  let federalResult = standardFederal;
  let stateResult = stateFor(federalResult);
  for (let pass = 0; pass < 10; pass++) {
    const nextFederal = federalFor(stateResult.tax);
    const nextState = stateFor(nextFederal);
    const settled =
      Math.abs(nextFederal.tax - federalResult.tax) < 0.005 &&
      Math.abs(nextState.tax - stateResult.tax) < 0.005;
    federalResult = nextFederal;
    stateResult = nextState;
    if (settled) break;
  }

  const match = employerMatch(
    profile.employer.match,
    payroll.traditional401k + payroll.roth401k,
    gross.total,
  );
  const employeeTotal =
    payroll.traditional401k +
    payroll.roth401k +
    ira.traditionalIra +
    ira.rothIra +
    payroll.hsa +
    payroll.healthPremiums +
    payroll.fsa +
    payroll.commuter;
  const totalTax = federalResult.tax + fica.total + stateResult.tax;

  return roundMoney<Breakdown>({
    taxYear,
    gross,
    contributions: {
      traditional401k: payroll.traditional401k,
      roth401k: payroll.roth401k,
      traditionalIra: ira.traditionalIra,
      rothIra: ira.rothIra,
      hsa: payroll.hsa,
      healthPremiums: payroll.healthPremiums,
      fsa: payroll.fsa,
      commuter: payroll.commuter,
      employeeTotal,
      employerMatch: match,
      employerHsa,
      employerOther: Math.max(0, profile.employer.other),
    },
    federal: federalResult,
    fica,
    state: stateResult,
    totals: {
      tax: totalTax,
      employeeContributions: employeeTotal,
      takeHome: gross.total - totalTax - employeeTotal,
      effectiveRate: gross.total > 0 ? totalTax / gross.total : 0,
      totalCompensation: gross.total + match + employerHsa + Math.max(0, profile.employer.other),
    },
    warnings: [...payroll.warnings, ...ira.warnings],
  });
}
