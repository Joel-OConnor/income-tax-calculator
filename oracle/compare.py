"""Compares our engine with PolicyEngine US for a grid of households.

    oracle/.venv/bin/python oracle/compare.py

PolicyEngine is an independent open-source tax model. Agreement is strong
evidence our numbers are right. A difference is not automatically our bug:
PolicyEngine models things we leave out (state credits for low incomes and
children, local taxes) and for some states it projects 2026 figures rather
than using the published ones. The report is for a person to triage.
"""

import json
import subprocess
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "oracle" / "out"
YEAR = 2026
TOLERANCE = 2.0  # dollars

STATES = sorted(json.loads((ROOT / "dataset/dist/2026.json").read_text())["states"])

# (label, filing status, wages, ages of children). Incomes sit above the
# earned income credit range. oracle/eitc.py covers lower incomes.
GRID = [
    ("single 40k", "single", 40_000, []),
    ("single 75k", "single", 75_000, []),
    ("single 120k", "single", 120_000, []),
    ("single 250k", "single", 250_000, []),
    ("joint 75k", "mfj", 75_000, []),
    ("joint 150k", "mfj", 150_000, []),
    ("joint 300k", "mfj", 300_000, []),
    ("joint 90k 2 kids", "mfj", 90_000, [5, 10]),
    ("joint 180k 2 kids", "mfj", 180_000, [5, 10]),
    ("head 60k 1 kid", "hoh", 60_000, [8]),
    ("head 110k 1 kid", "hoh", 110_000, [8]),
]
# Pre-tax contributions, for the states that treat them differently and a few that do not.
CONTRIBUTION_STATES = ["CA", "NJ", "PA", "NY", "TX", "IL", "MA"]
CONTRIBUTIONS = [
    ("single 100k 401k 10k", "single", 100_000, [], 10_000, 0),
    ("single 100k HSA 3k", "single", 100_000, [], 0, 3_000),
]


def build_cases():
    cases = []
    for state in STATES:
        for label, status, wages, children in GRID:
            cases.append(dict(state=state, label=label, status=status, wages=wages,
                              children=children, k401=0, hsa=0))
    for state in CONTRIBUTION_STATES:
        for label, status, wages, children, k401, hsa in CONTRIBUTIONS:
            cases.append(dict(state=state, label=label, status=status, wages=wages,
                              children=children, k401=k401, hsa=hsa))
    for i, case in enumerate(cases):
        case["id"] = f"c{i:04d}"
    return cases


def build_situation(cases):
    """One PolicyEngine situation holding every case as its own household."""
    s = {k: {} for k in ("people", "tax_units", "families", "spm_units", "marital_units", "households")}
    for c in cases:
        i = c["id"]
        adult = f"{i}_adult"
        s["people"][adult] = {
            "age": {YEAR: 40},
            "employment_income": {YEAR: c["wages"]},
            "traditional_401k_contributions": {YEAR: c["k401"]},
            "health_savings_account_payroll_contributions": {YEAR: c["hsa"]},
        }
        members, couple = [adult], [adult]
        if c["status"] == "mfj":
            spouse = f"{i}_spouse"
            s["people"][spouse] = {"age": {YEAR: 40}, "employment_income": {YEAR: 0}}
            members.append(spouse)
            couple.append(spouse)
        s["marital_units"][f"{i}_m"] = {"members": couple}
        for k, age in enumerate(c["children"]):
            child = f"{i}_child{k}"
            s["people"][child] = {"age": {YEAR: age}, "employment_income": {YEAR: 0}}
            members.append(child)
            s["marital_units"][f"{i}_m{k}"] = {"members": [child]}
        for group in ("tax_units", "families", "spm_units"):
            s[group][f"{i}_{group}"] = {"members": members}
        # PolicyEngine otherwise assumes marketplace health insurance and gives
        # lower earners a premium tax credit, which changes Oregon's federal tax
        # subtraction. Our households have employer coverage.
        s["tax_units"][f"{i}_tax_units"]["assigned_aca_ptc"] = {YEAR: 0}
        s["households"][f"{i}_h"] = {"members": members, "state_code": {YEAR: c["state"]}}
    return s


def run_engine(cases):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "cases.json"
    path.write_text(json.dumps(cases))
    done = subprocess.run(["node", str(ROOT / "oracle/engine.ts"), str(path)],
                          capture_output=True, text=True, check=True)
    return {r["id"]: r for r in json.loads(done.stdout)}


def run_policyengine(cases):
    from policyengine_us import Simulation

    sim = Simulation(situation=build_situation(cases))
    per_unit = lambda name: sim.calculate(name, YEAR, map_to="tax_unit")

    # Tax units are returned in the order they were added. Check that rather than trust it.
    wages = per_unit("employment_income")
    assert all(abs(float(w) - c["wages"]) < 0.5 for w, c in zip(wages, cases)), "case order mismatch"

    status = sim.calculate("filing_status", YEAR)
    if hasattr(status, "decode_to_str"):  # enum values come back as codes
        status = status.decode_to_str()
    expected = {"single": "SINGLE", "mfj": "JOINT", "hoh": "HEAD_OF_HOUSEHOLD"}
    wrong = [c["id"] for c, got in zip(cases, status) if str(got) != expected[c["status"]]]
    assert not wrong, f"PolicyEngine assigned a different filing status for {wrong[:5]}"

    columns = {
        "federal": per_unit("income_tax"),
        "payroll": per_unit("employee_social_security_tax") + per_unit("employee_medicare_tax")
        + per_unit("additional_medicare_tax"),
        "state": per_unit("state_income_tax"),
        "stateBeforeRefundable": per_unit("state_income_tax_before_refundable_credits"),
        "federalTaxable": per_unit("taxable_income"),
        "stateTaxable": per_unit("state_taxable_income"),
    }
    return {c["id"]: {k: float(v[n]) for k, v in columns.items()} for n, c in enumerate(cases)}


def main():
    cases = build_cases()
    print(f"{len(cases)} households across {len(STATES)} jurisdictions", file=sys.stderr)
    ours = run_engine(cases)
    theirs = run_policyengine(cases)

    rows = []
    for c in cases:
        a, b = ours[c["id"]], theirs[c["id"]]
        rows.append({
            **{k: c[k] for k in ("id", "state", "label", "status", "wages", "k401", "hsa")},
            "ours": a, "policyengine": b,
            "diff": {k: round(a[k] - b[k], 2) for k in ("federal", "payroll", "state")},
        })
    (OUT / "report.json").write_text(json.dumps(rows, indent=1))

    for part in ("federal", "payroll", "state"):
        off = [r for r in rows if abs(r["diff"][part]) > TOLERANCE]
        print(f"\n{part}: {len(rows) - len(off)} of {len(rows)} within ${TOLERANCE:.0f}")
        if part != "state":
            for r in off[:12]:
                print(f"  {r['state']} {r['label']}: ours {r['ours'][part]:.2f}, "
                      f"PolicyEngine {r['policyengine'][part]:.2f}")

    print("\nstate income tax by state (ours minus PolicyEngine, dollars):")
    for state in STATES:
        mine = [r for r in rows if r["state"] == state]
        off = [r for r in mine if abs(r["diff"]["state"]) > TOLERANCE]
        if not off:
            print(f"  {state}: all {len(mine)} match")
            continue
        detail = ", ".join(f"{r['label']} {r['diff']['state']:+.0f}" for r in off)
        print(f"  {state}: {len(mine) - len(off)}/{len(mine)} match | {detail}")


if __name__ == "__main__":
    main()
