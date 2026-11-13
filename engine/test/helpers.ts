import { readFileSync } from "node:fs";
import type { Amount, Bundle, Profile } from "../src/index.ts";

export const data: Bundle = JSON.parse(
  readFileSync(new URL("../../dataset/dist/2026.json", import.meta.url), "utf8"),
);

export const usd = (value: number): Amount => ({ kind: "dollars", value });
export const pct = (value: number): Amount => ({ kind: "percent", value });

type Overrides = Partial<Omit<Profile, "contributions" | "employer" | "dependents">> & {
  contributions?: Partial<Profile["contributions"]>;
  employer?: Partial<Profile["employer"]>;
  dependents?: Partial<Profile["dependents"]>;
};

/** A single 35-year-old Texan on salary with no contributions, plus overrides. */
export function profile(annual: number, overrides: Overrides = {}): Profile {
  const { contributions, employer, dependents, ...rest } = overrides;
  return {
    state: "TX",
    filingStatus: "single",
    age: 35,
    income: { kind: "salary", annual },
    bonus: 0,
    coveredByWorkplacePlan: true,
    ...rest,
    dependents: { children: 0, other: 0, ...dependents },
    contributions: {
      traditional401k: usd(0),
      roth401k: usd(0),
      traditionalIra: usd(0),
      rothIra: usd(0),
      hsa: usd(0),
      hsaCoverage: "none",
      hsaViaPayroll: true,
      healthPremiums: usd(0),
      fsa: usd(0),
      commuter: usd(0),
      ...contributions,
    },
    employer: { match: [], hsa: 0, other: 0, ...employer },
  };
}
