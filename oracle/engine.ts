// Runs the comparison cases through our engine and prints the results as JSON.
//   node oracle/engine.ts oracle/out/cases.json

import { readFileSync } from "node:fs";
import { calculate } from "../engine/src/index.ts";
import type { Amount, Bundle, FilingStatus, Profile } from "../engine/src/index.ts";

interface Case {
  id: string;
  state: string;
  status: FilingStatus;
  wages: number;
  children: number[];
  k401: number;
  hsa: number;
  /** Optional extras used by oracle/flags.py. */
  hsaDirect?: number;
  ira?: number;
  premiums?: number;
  /** The filer's age. Defaults to 40. */
  age?: number;
}

const data: Bundle = JSON.parse(
  readFileSync(new URL("../dataset/dist/2026.json", import.meta.url), "utf8"),
);
const cases: Case[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
const usd = (value: number): Amount => ({ kind: "dollars", value });

const results = cases.map((c) => {
  const profile: Profile = {
    state: c.state,
    filingStatus: c.status,
    age: c.age ?? 40,
    dependents: { children: c.children.length, other: 0, childAges: c.children },
    income: { kind: "salary", annual: c.wages },
    bonus: 0,
    coveredByWorkplacePlan: c.k401 > 0,
    contributions: {
      traditional401k: usd(c.k401),
      roth401k: usd(0),
      traditionalIra: usd(c.ira ?? 0),
      rothIra: usd(0),
      hsa: usd(c.hsa + (c.hsaDirect ?? 0)),
      hsaCoverage: c.hsa + (c.hsaDirect ?? 0) > 0 ? "self" : "none",
      hsaViaPayroll: !c.hsaDirect,
      healthPremiums: usd(c.premiums ?? 0),
      fsa: usd(0),
      commuter: usd(0),
    },
    employer: { match: [], hsa: 0, other: 0 },
  };
  const b = calculate(profile, data);
  return {
    id: c.id,
    federal: b.federal.tax,
    payroll: b.fica.total,
    state: b.state.tax,
    federalEitc: b.federal.earnedIncomeCredit,
    stateEitc: b.state.earnedIncomeCredit,
    stateChildCredits: b.state.childCredits,
    federalTaxable: b.federal.taxableIncome,
    stateTaxable: b.state.taxableIncome,
  };
});

console.log(JSON.stringify(results));
