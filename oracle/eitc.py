"""Checks the earned income credit, federal and state, against PolicyEngine US.

    oracle/.venv/bin/python oracle/eitc.py

Runs lower-income households in every jurisdiction and compares the credit
itself, not the tax, so other low-income rules we do not model (renter and
sales tax credits, low-income exemptions) stay out of the way. PolicyEngine
projects some 2026 figures and simplifies some states, so a difference is a
prompt to read the state's rule, not proof of a mistake.
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

# (label, filing status, wages, ages of children, filer's age)
HOUSEHOLDS = [
    ("single 9k", "single", 9_000, [], 30),
    ("single 15k", "single", 15_000, [], 30),
    ("single 22k", "single", 22_000, [], 30),
    ("single 12k age 22", "single", 12_000, [], 22),
    ("head 15k 1 kid", "hoh", 15_000, [8], 30),
    ("head 28k 1 kid", "hoh", 28_000, [8], 30),
    ("head 45k 1 kid", "hoh", 45_000, [8], 30),
    ("head 20k 2 kids", "hoh", 20_000, [2, 9], 30),
    ("head 35k 2 kids", "hoh", 35_000, [2, 9], 30),
    ("head 55k 2 kids", "hoh", 55_000, [2, 9], 30),
    ("joint 30k 3 kids", "mfj", 30_000, [4, 6, 11], 30),
    ("joint 50k 3 kids", "mfj", 50_000, [4, 6, 11], 30),
    ("joint 68k 3 kids", "mfj", 68_000, [4, 6, 11], 30),
]


def build_cases():
    cases = []
    for state in STATES:
        for label, status, wages, children, age in HOUSEHOLDS:
            cases.append({"state": state, "label": label, "status": status, "wages": wages,
                          "children": children, "age": age, "k401": 0, "hsa": 0})
    for i, case in enumerate(cases):
        case["id"] = f"e{i:04d}"
    return cases


def run_engine(cases):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "eitc-cases.json"
    path.write_text(json.dumps(cases))
    done = subprocess.run(["node", str(ROOT / "oracle/engine.ts"), str(path)],
                          capture_output=True, text=True, check=True)
    return {r["id"]: r for r in json.loads(done.stdout)}


def run_policyengine(cases):
    from policyengine_us import Simulation

    s = {k: {} for k in ("people", "tax_units", "families", "spm_units", "marital_units", "households")}
    for c in cases:
        i = c["id"]
        adult = f"{i}_adult"
        s["people"][adult] = {"age": {YEAR: c["age"]}, "employment_income": {YEAR: c["wages"]}}
        members, couple = [adult], [adult]
        if c["status"] == "mfj":
            spouse = f"{i}_spouse"
            s["people"][spouse] = {"age": {YEAR: c["age"]}, "employment_income": {YEAR: 0}}
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
    unit = lambda name: sim.calculate(name, YEAR, map_to="tax_unit")
    wages = unit("employment_income")
    assert all(abs(float(w) - c["wages"]) < 0.5 for w, c in zip(wages, cases)), "case order mismatch"
    columns = {"federalEitc": unit("eitc"), "stateEitc": unit("taxsim_state_eitc"),
               "stateChildCredits": unit("taxsim_state_ctc"), "state": unit("state_income_tax")}
    return {c["id"]: {k: float(v[n]) for k, v in columns.items()} for n, c in enumerate(cases)}


def main():
    cases = build_cases()
    ours = run_engine(cases)
    theirs = run_policyengine(cases)
    rows = []
    for c in cases:
        a, b = ours[c["id"]], theirs[c["id"]]
        rows.append({"state": c["state"], "household": c["label"],
                     "ours": {k: round(a[k], 2) for k in b}, "policyengine": {k: round(v, 2) for k, v in b.items()}})
    (OUT / "eitc.json").write_text(json.dumps(rows, indent=1))

    # Minnesota phases its child credit and working family credit out as one
    # amount, and each model reports that amount under a different heading.
    combined = {"MN"}
    for r in rows:
        if r["state"] in combined:
            for side in ("ours", "policyengine"):
                r[side]["stateEitc"] = round(r[side]["stateEitc"] + r[side]["stateChildCredits"], 2)
                r[side]["stateChildCredits"] = 0.0

    diff = lambda r, k: r["ours"][k] - r["policyengine"][k]
    texas = [r for r in rows if r["state"] == "TX"]
    off = [r for r in texas if abs(diff(r, "federalEitc")) > TOLERANCE]
    print(f"federal credit: {len(texas) - len(off)} of {len(texas)} households within ${TOLERANCE:.0f}")
    for r in off:
        print(f"  {r['household']}: ours {r['ours']['federalEitc']:.0f}, PolicyEngine {r['policyengine']['federalEitc']:.0f}")

    off = [r for r in rows if abs(diff(r, "stateEitc")) > TOLERANCE]
    print(f"\nstate credit: {len(rows) - len(off)} of {len(rows)} within ${TOLERANCE:.0f}")
    for state in STATES:
        mine = [r for r in rows if r["state"] == state]
        bad = [r for r in mine if abs(diff(r, "stateEitc")) > TOLERANCE]
        has = any(r["ours"]["stateEitc"] or r["policyengine"]["stateEitc"] for r in mine)
        if not has:
            continue
        if not bad:
            print(f"  {state}: all {len(mine)} match")
        else:
            print(f"  {state}: {len(mine) - len(bad)}/{len(mine)} | " + ", ".join(
                f"{r['household']} {r['ours']['stateEitc']:.0f}/{r['policyengine']['stateEitc']:.0f}" for r in bad))


if __name__ == "__main__":
    main()
