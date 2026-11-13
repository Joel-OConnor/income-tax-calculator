"""Checks how each state treats pre-tax contributions, against PolicyEngine US.

    oracle/.venv/bin/python oracle/flags.py

For every jurisdiction it runs one household with no contributions and then
one with each kind of contribution, and compares how much state income tax
moved in our engine and in PolicyEngine. Comparing the movement, not the tax,
isolates the treatment of the contribution from every other difference.
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
TOLERANCE = 2.0
WAGES = 100_000

STATES = sorted(json.loads((ROOT / "dataset/dist/2026.json").read_text())["states"])

# label -> contribution amounts
VARIANTS = {
    "none": {},
    "401k": {"k401": 10_000},
    "HSA by payroll": {"hsa": 3_000},
    "HSA direct": {"hsaDirect": 3_000},
    "IRA": {"ira": 5_000},
    "premiums": {"premiums": 4_000},
}


def build_cases():
    cases = []
    for state in STATES:
        for label, amounts in VARIANTS.items():
            cases.append({"state": state, "label": label, "status": "single", "wages": WAGES,
                          "children": [], "k401": 0, "hsa": 0, "hsaDirect": 0, "ira": 0,
                          "premiums": 0, **amounts})
    for i, case in enumerate(cases):
        case["id"] = f"f{i:04d}"
    return cases


def run_engine(cases):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "flag-cases.json"
    path.write_text(json.dumps(cases))
    done = subprocess.run(["node", str(ROOT / "oracle/engine.ts"), str(path)],
                          capture_output=True, text=True, check=True)
    return {r["id"]: r["state"] for r in json.loads(done.stdout)}


def run_policyengine(cases):
    from policyengine_us import Simulation

    s = {k: {} for k in ("people", "tax_units", "families", "spm_units", "marital_units", "households")}
    for c in cases:
        i = c["id"]
        adult = f"{i}_adult"
        s["people"][adult] = {
            "age": {YEAR: 40},
            "employment_income": {YEAR: c["wages"]},
            "traditional_401k_contributions": {YEAR: c["k401"]},
            "health_savings_account_payroll_contributions": {YEAR: c["hsa"]},
            "traditional_ira_contributions": {YEAR: c["ira"]},
            "pre_tax_health_insurance_premiums": {YEAR: c["premiums"]},
        }
        s["marital_units"][f"{i}_m"] = {"members": [adult]}
        for group in ("tax_units", "families", "spm_units"):
            s[group][f"{i}_{group}"] = {"members": [adult]}
        s["tax_units"][f"{i}_tax_units"]["assigned_aca_ptc"] = {YEAR: 0}
        s["tax_units"][f"{i}_tax_units"]["health_savings_account_ald"] = {YEAR: c["hsaDirect"]}
        s["households"][f"{i}_h"] = {"members": [adult], "state_code": {YEAR: c["state"]}}
    sim = Simulation(situation=s)
    tax = sim.calculate("state_income_tax", YEAR, map_to="tax_unit")
    agi = sim.calculate("adjusted_gross_income", YEAR, map_to="tax_unit")
    return ({c["id"]: float(tax[n]) for n, c in enumerate(cases)},
            {c["id"]: float(agi[n]) for n, c in enumerate(cases)})


def main():
    cases = build_cases()
    ours = run_engine(cases)
    theirs, their_agi = run_policyengine(cases)

    base = {c["state"]: c["id"] for c in cases if c["label"] == "none"}
    # Confirm PolicyEngine took each contribution off federal income as expected.
    for c in cases:
        if c["state"] == "TX":
            print(f"federal AGI, {c['label']}: {their_agi[c['id']]:.0f}", file=sys.stderr)

    report, disagreements = [], 0
    for c in cases:
        if c["label"] == "none":
            continue
        b = base[c["state"]]
        mine = ours[c["id"]] - ours[b]
        other = theirs[c["id"]] - theirs[b]
        agree = abs(mine - other) <= TOLERANCE
        disagreements += not agree
        report.append({"state": c["state"], "contribution": c["label"],
                       "oursChange": round(mine, 2), "policyengineChange": round(other, 2),
                       "agree": agree})
    (OUT / "flags.json").write_text(json.dumps(report, indent=1))

    print(f"{len(report) - disagreements} of {len(report)} agree within ${TOLERANCE:.0f}")
    for r in report:
        if not r["agree"]:
            print(f"  {r['state']} {r['contribution']}: state tax changes by "
                  f"{r['oursChange']:+.0f} in ours, {r['policyengineChange']:+.0f} in PolicyEngine")
    print("\nstates where a contribution does not lower state tax (ours / PolicyEngine):")
    for r in report:
        if abs(r["oursChange"]) < 1 or abs(r["policyengineChange"]) < 1:
            if json.loads((ROOT / "dataset/dist/2026.json").read_text())["states"][r["state"]]["incomeTax"]["type"] != "none":
                print(f"  {r['state']} {r['contribution']}: {r['oursChange']:+.0f} / {r['policyengineChange']:+.0f}")


if __name__ == "__main__":
    main()
