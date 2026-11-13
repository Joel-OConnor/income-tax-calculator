# Income Tax Calculator

A local web app that works out take-home pay from a salary or hourly rate, for tax year 2026, in any US state.

It's an estimate, not tax advice.

## What it does

- Takes annual salary or an hourly rate, plus bonus, and shows gross and net by hour, day, week, month, quarter and year.
- Compares your pay now against a raise or cut, in dollars or percent.
- Splits tax into federal income tax, Social Security and Medicare, and state income tax, with the brackets each dollar fell in.
- Handles 401k, IRA, Roth, HSA, FSA, commuter and health premium contributions, as dollars or a percent of pay, with employer match.
- Covers single, married filing jointly and head of household, with dependents and each child's age.
- Includes the child tax credit, the earned income credit, and the state versions of both.
- Compares the same pay across all 50 states and DC.
- Charts tax against income and marks where the rules change.

## Running it

Needs Node 26 or later, which runs TypeScript directly.

```bash
npm install
```

```bash
npm run build:data
```

```bash
npm run dev
```

Then open http://localhost:3000. Your inputs are saved in a local SQLite file under `web/data/`, which is not in the repository.

```bash
npm test
```

## How it's put together

- `dataset/`: the tax figures for each year, one JSON file per jurisdiction, each value cited to the publication it came from and marked `primary`, `secondary` or `unverified`. `npm run build:data` validates everything and writes `dataset/dist/`, which the app syncs from at startup. See [dataset/README.md](dataset/README.md).
- `engine/`: a pure TypeScript library. `calculate(profile, data)` returns the full breakdown. No I/O.
- `web/`: the Next.js app.
- `oracle/`: scripts that compare the engine against [PolicyEngine US](https://github.com/PolicyEngine/policyengine-us), an independent open-source tax model. Optional, needs Python.

[PLAN.md](PLAN.md) has the design, what's been checked and how, and what's still left out.

## What it doesn't cover

State payroll contributions (disability and paid leave), local income taxes, itemized deductions beyond state income tax, self-employment income, and a spouse's income as a separate input. Each state's page in the app lists the rules it leaves out.

Some 2026 figures weren't published when the data was built, so a few states use 2025 values. `npm run build:data` lists them.
