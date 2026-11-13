"""Checks state credits and deductions for children against PolicyEngine US.

    oracle/.venv/bin/python oracle/children.py

Two comparisons for every jurisdiction, at several incomes:

1. Age. The same family is run with 16-year-olds and then with younger
   children, and the change in state income tax is compared. Only rules that
   depend on a child's age move it, so every other difference drops out.
2. Level. State income tax for the family with 16-year-olds, ours against
   PolicyEngine's. This catches credits that do not depend on age, but it also
   picks up state earned income credits, which we do not model.
"""

import json
import subprocess
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "oracle" / "out"
YEAR = 2026
TOLERANCE = 2.0

STATES = sorted(json.loads((ROOT / "dataset/dist/2026.json").read_text())["states"])

FAMILIES = [
    ("head 30k", "hoh", 30_000),
    ("head 60k", "hoh", 60_000),
    ("joint 90k", "mfj", 90_000),
    ("joint 140k", "mfj", 140_000),
    ("joint 200k", "mfj", 200_000),
]
# baseline ages -> the younger ages compared with it
AGES = {
    (16,): [(2,), (5,), (8,), (12,)],
    (16, 16): [(3, 9)],
}


def build_cases():
    cases = []
    for state in STATES:
        for label, status, wages in FAMILIES:
            for baseline, others in AGES.items():
                for ages in [baseline, *others]:
                    cases.append({"state": state, "label": label, "status": status, "wages": wages,
                                  "children": list(ages), "baseline": list(baseline),
                                  "k401": 0, "hsa": 0})
    for i, case in enumerate(cases):
        case["id"] = f"k{i:04d}"
    return cases


def run_engine(cases):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "children-cases.json"
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
        s["people"][adult] = {"age": {YEAR: 40}, "employment_income": {YEAR: c["wages"]}}
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
        s["tax_units"][f"{i}_tax_units"]["assigned_aca_ptc"] = {YEAR: 0}
        s["households"][f"{i}_h"] = {"members": members, "state_code": {YEAR: c["state"]}}
    sim = Simulation(situation=s)
    tax = sim.calculate("state_income_tax", YEAR, map_to="tax_unit")
    wages = sim.calculate("employment_income", YEAR, map_to="tax_unit")
    assert all(abs(float(w) - c["wages"]) < 0.5 for w, c in zip(wages, cases)), "case order mismatch"
    return {c["id"]: float(tax[n]) for n, c in enumerate(cases)}


def main():
    cases = build_cases()
    ours = run_engine(cases)
    theirs = run_policyengine(cases)

    key = lambda c, ages: (c["state"], c["label"], tuple(ages))
    by_key = {key(c, c["children"]): c["id"] for c in cases}

    age_rows, level_rows = [], []
    for c in cases:
        base = by_key[key(c, c["baseline"])]
        row = {"state": c["state"], "family": c["label"], "ages": c["children"]}
        if c["id"] == base:
            level_rows.append({**row, "ours": round(ours[base], 2), "policyengine": round(theirs[base], 2),
                               "diff": round(ours[base] - theirs[base], 2)})
            continue
        mine, other = ours[c["id"]] - ours[base], theirs[c["id"]] - theirs[base]
        age_rows.append({**row, "oursChange": round(mine, 2), "policyengineChange": round(other, 2),
                         "agree": abs(mine - other) <= TOLERANCE})
    (OUT / "children.json").write_text(json.dumps({"age": age_rows, "level": level_rows}, indent=1))

    off = [r for r in age_rows if not r["agree"]]
    print(f"age: {len(age_rows) - len(off)} of {len(age_rows)} agree within ${TOLERANCE:.0f}")
    print("state tax change from 16-year-olds to the ages shown (ours / PolicyEngine):")
    for state in STATES:
        mine = [r for r in age_rows if r["state"] == state]
        moved = [r for r in mine if abs(r["oursChange"]) > 1 or abs(r["policyengineChange"]) > 1]
        if not moved:
            continue
        bad = [r for r in mine if not r["agree"]]
        print(f"  {state}: {len(mine) - len(bad)}/{len(mine)} agree")
        for r in bad:
            print(f"      {r['family']} ages {r['ages']}: {r['oursChange']:+.0f} / {r['policyengineChange']:+.0f}")

    off = [r for r in level_rows if abs(r["diff"]) > TOLERANCE]
    print(f"\nlevel: {len(level_rows) - len(off)} of {len(level_rows)} within ${TOLERANCE:.0f}")
    for state in STATES:
        bad = [r for r in off if r["state"] == state]
        if bad:
            print(f"  {state}: " + ", ".join(f"{r['family']} x{len(r['ages'])} {r['diff']:+.0f}" for r in bad))


if __name__ == "__main__":
    main()
