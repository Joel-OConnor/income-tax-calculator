# Income Tax Calculator: Plan

A local app that takes an income figure (annual salary or hourly rate) and shows what it actually turns into after federal tax, state tax, payroll taxes, and retirement/benefit contributions. It compares a base income against a raised or lowered scenario, and compares the same income across states.

## Decisions made

- Local only for now. No accounts, no hosting.
- Tax data lives in SQLite and syncs from our own versioned JSON dataset hosted on GitHub.
- Filing statuses: single, married filing jointly, head of household.
- Dependents are in v1 for federal (child tax credit, other dependent credit). State dependent exemptions and credits go in wherever the source data has them cleanly.
- All 50 states plus DC at the level of brackets, standard deduction, and personal exemptions. Local taxes are out of v1.
- W-2 income only. No self-employment.

## Stack

- TypeScript throughout
- Next.js for UI and the local server
- SQLite with Drizzle
- Recharts for charts
- Vitest for tests
- Zod to validate synced data before it touches the DB

The tax engine is a pure function library with no I/O: profile and tax data in, full breakdown out. The chart and the state comparison are both just that function called many times.

## Tax data and sync

There is no official API for tax brackets. The IRS publishes federal figures in a yearly Revenue Procedure, and each state publishes its own. So we maintain one dataset:

- A versioned JSON file per tax year in a GitHub repo.
- Every group of values carries a citation and a confidence level, so any number can be traced.
- Built from IRS publications and each state's own revenue department publications.
- PolicyEngine (open source) is the test oracle: we check our results against it for sample households.

### What the data source spike found (November 2026)

- **Federal is solid.** The IRS Revenue Procedure has brackets, standard deduction, child tax credit, FSA and commuter limits in one PDF. Retirement limits come from a yearly IRS news release, HSA limits from a separate Revenue Procedure.
- **Tax Foundation is a cross-check only.** Its state table covers single and married filers but not head of household, and some rows lag a year. California's standard deduction there was the 2024 figure.
- **State data comes from each state's own publications.** PolicyEngine's parameter files are a good finding aid: each one links to the exact official form or statute page, and they include head of household.
- **Some official sites block automated fetching** (California FTB and SSA returned 403), and IRS PDFs need to be read as PDFs. So building each year's dataset is a curated, assisted job, done once a year plus mid-year fixes. The app's own sync stays fully automatic because it only pulls our finished dataset.
- **PolicyEngine's hosted API needs credentials** and its terms don't fit automated test use. Use the open-source Python package locally as a dev-time oracle instead. Not yet tried.
- **States publish on different schedules.** The dataset records which tax year each group of values is really from (`valuesTaxYear`), so the app can say "using 2025 brackets" when a state hasn't published yet.
- **First tax year is 2026.** Federal 2027 income tax figures are out (Rev. Proc. 2026-35), but 2027 retirement limits, the Social Security wage base, and state figures are not, so 2027 waits.

### Dataset layout (`dataset/`)

- `schema.ts`: Zod schemas for federal, state, bundle and manifest. Shared with the app.
- `schedule.ts`: how an income schedule (phase-out or tax adjustment) is evaluated. Shared with the engine.
- `src/<year>/federal.json` and `src/<year>/states/<ST>.json`: hand-curated source files.
- `build.ts`: validates everything, checks citations, writes `dist/<year>.json` and `dist/manifest.json` (with a hash per year). `npm run build` prints what is still secondary, unverified or stale.
- Confidence levels: `primary` (read from the official publication), `secondary` (aggregator or summary), `unverified` (general knowledge, must be checked).

- `README.md`: authoring conventions and the order of sources to trust. Read it before adding or updating a state.

### Current state of the 2026 data

All 50 states and DC are in. Of 244 groups of values, 153 are primary, 90 secondary and 1 unverified (the refundable child tax credit rule in the federal file).

- **Brackets:** read from the state's own publication for 38 of the 43 jurisdictions that tax wages. Still secondary: CO, IL, NJ, NY, PA (from the first spike) and ME (maine.gov blocks both the fetch tool and the browser pane).
- **Using 2025 values because 2026 is not published yet:** AR, DC, MD and VT standard deductions, AR, IA, NM, UT and VT exemptions, ID bracket threshold, the child credits in CA, CO, ME, NM and OR, California's earned income credit, and the income limit in DC's credit for filers without children. `npm run build` lists these as stale. Recheck when the 2026 return booklets come out (December to January).
- **Rule flags were checked on 2026-11-12** and none is unverified now. See the next section.
- **Mid-2026 law changes are in.** Georgia (4.99%), South Carolina (new two-bracket schedule and deduction), Utah (4.45%), West Virginia, Arkansas and Oklahoma all changed rates during 2026. Tax Foundation's table predates most of them.

### How each state treats pre-tax money, payroll and local taxes (checked 2026-11-12)

The flags say whether a state taxes money that is pre-tax or deductible federally. There are six: 401k, HSA, IRA, health premiums, flexible spending and commuter benefits. Most states follow the federal treatment. The exceptions, each read in the state's own publications:

- **New Jersey** taxes everything but a 401k: health premiums, flexible spending and commuter money taken by salary reduction (TB-39(R), TB-24(R), 2025 NJ-1040 instructions), HSA and IRA contributions, and other retirement plans such as a 403(b). Premiums it taxes count as medical expenses, deductible above 2% of income, and that is modeled.
- **Pennsylvania** taxes 401k and other retirement contributions and commuter benefits, and gives no IRA deduction. Health premiums, flexible spending and HSA contributions are not taxed.
- **California** taxes HSA contributions, including the employer's.
- **Massachusetts** gives no deduction for IRA contributions.

Before this pass the engine treated premiums, flexible spending and commuter money as untaxed in New Jersey, commuter money as untaxed in Pennsylvania, and gave Massachusetts filers the IRA deduction. All three were wrong and are fixed.

For every other state the flags rest on `oracle/flags.py`, which runs each kind of contribution through PolicyEngine in all 51 jurisdictions and compares how far state tax moves. 241 of 255 cases agree. The 14 that differ are explained: Arkansas's unmodeled high-income table and two deductions PolicyEngine leaves out, a one-dollar boundary in Missouri where the statute backs ours, PolicyEngine's reversed 401k treatment in New Jersey and Pennsylvania, Pennsylvania's HSA deduction, and $5 in Utah from a later year's threshold. Alabama, Arkansas, Mississippi and Massachusetts were also read in their own instructions. The rest are marked `secondary` because nobody read the state's own form.

**Employee payroll contributions** exist in 16 states, each confirmed on the state agency's page with its 2026 rate: AK, CA, CO, CT, DE, HI, MA, ME, MN, NJ, NY, OR, PA, RI, VT, WA. Alaska was missing before. The rates and wage caps are in each state's notes and are not computed yet. Maryland's start in 2027.

**Local taxes on wages** exist in 14 states: AL, CO, DE, IA, IN, KY, MD, MI, MO, NY, OH, OR, PA, WV. Colorado (Denver's $5.75 a month) and West Virginia (Charleston's $3 a week) were added. Several city rates come from Tax Foundation's 2023 table because the city sites block automated reading.

Not checked: Colorado's even split of the paid leave premium and its wage cap (the program's site blocks reading), and whether New Jersey counts expenses repaid from a taxed flexible spending account toward the medical deduction.

### State credits for children (added 2026-11-12)

The calculator now asks each child's age, and 15 states have a credit in `incomeTax.childCredits`. Every one was read in the state's statute or form, so all are `primary`.

| State | Rule for 2026 | Refundable | Figures |
| --- | --- | --- | --- |
| CA | One $1,189 credit per return with a child under 6, for earned income up to $32,900 | Yes | 2025 |
| CO | $1,200, $600 or $200 per child under 6 by income, nothing over $77,000 ($87,000 joint) | Yes | 2025 tiers |
| GA | $250 per child under 6, new for 2026 | No | 2026 |
| IL | 40% of the Illinois earned income credit, for a filer with a child under 12 | Yes | 2026 |
| MA | $440 per child under 13 | Yes | 2026 |
| MD | $500 per child under 6, gone above $24,000 of income | Yes | 2026 |
| ME | $305 per dependent, $610 under 6, shrinking above $100,000 ($150,000 joint) | Yes | 2025 |
| MN | $1,800 per child plus the working family credit, shrinking above $32,680 ($38,770 joint) | Yes | 2026 |
| NJ | $1,250 down to $250 per child under 6 by income, nothing over $80,000 | Yes | 2026 |
| NM | $637 down to $26 per child by income | Yes | 2025 |
| NY | $1,000 per child under 4, $500 from 4 to 16, shrinking above $75,000 ($110,000 joint) | Yes | 2026 |
| OK | 5% of the federal child tax credit, up to $100,000 of income | No | 2026 |
| OR | $1,050 per child under 6, gone above $31,550 of income | Yes | 2025 |
| UT | $1,000 per child under 6, shrinking above $49,000 ($61,000 joint) | No | 2026 |
| VT | $1,000 per child 6 or under, shrinking above $125,000 | Yes | 2026 |

Three more age rules went into `personalExemption`: South Carolina's extra deduction for a child under 6 (and its 2026 exemption of $5,040), Arizona's $25 for a dependent 17 or older, and Maine's dependent credit moved out to `childCredits`.

Things that changed during 2026 and were easy to get wrong: New Jersey raised its credit by a quarter for 2026 to 2028, Minnesota's credit is indexed from 2026 ($1,800, not $1,750), Utah raised its income limits, Georgia's credit is new, Vermont's age limit went up a year in 2025, and Colorado's Family Affordability Tax Credit is not available for 2026.

Not entered, on purpose:

- **DC.** The 2024 child tax credit was repealed before it took effect. A temporary replacement ($1,000 per child, shrinking above $55,000) was disapproved by Congress and has expired, and the tax office has published nothing for 2026. Nothing is entered and the DC notes say so. PolicyEngine models the $1,000 version.
- **Nebraska.** Its credit needs a child in licensed care, an application, and runs out at a statewide cap.
- **Idaho.** The $205 credit ended after 2025. Rhode Island's starts in 2027.

To recheck when the 2026 return booklets are out (late December to January): California's amount and limits, Colorado's income tiers, Maine's amount and limits, New Mexico's table, Oregon's amount and limit, and South Carolina's $5,040, which was read in a pre-release copy of the 2026 instructions. Estimates from the statutory formulas are in each group's `note` and were not entered.

### Earned income credit (added 2026-11-12)

**Federal.** `credits.earnedIncomeCredit` in `federal.json` holds the 2026 table from Rev. Proc. 2025-32: a maximum of $664 with no children, $4,427 with one, $7,316 with two and $8,231 with three or more, ending at $19,540, $51,593, $58,629 and $62,974 of income (about $7,300 higher for joint filers). The engine uses the statute's formula. The Form 1040 instructions print the credit in $50 bands, so a real return can differ by a few dollars.

**States.** 31 states and DC have one in `incomeTax.earnedIncomeCredit`. All but Oklahoma's were read in the state's statute or form.

- **A plain share of the federal credit, refundable:** CO 25%, CT 40% plus $250 with a child, HI 40%, IA 15%, IL 20%, IN 10%, KS 17%, LA 5%, MA 40%, MI 30%, MT 20%, NE 10%, NJ 40%, NM 25%, NY 30%, PA 10%, RI 16%, VA 20%.
- **Not refundable:** MO 20%, OH 30%, UT 20%, and SC 125% capped at $200.
- **The filer's choice, and the engine takes the better one:** DE (4.5% refundable or 20% against tax), MD (45% refundable or 50% against tax).
- **Different with and without children:** DC (85% with a child, its own longer phase-out without), MD and VT (100% without a child), ME (50% without, 25% with), WI (4%, 11% or 34% by number of children, nothing without).
- **By a child's age:** OR, 17% with a child under 3 and 14% otherwise.
- **Their own formula:** CA (a schedule that reproduces the 2025 table to the dollar), MN (the working family credit), OK (5% of the federal credit as it stood in 2020, which the form still uses).
- **Wider ages for filers without children:** CA, IL and NJ from 18 with no upper limit, ME and NM from 18, CO and MN from 19, MD at any age under 65.

Changed for 2026 and easy to get wrong: Colorado fell from 50% to 25%, Montana doubled to 20%, Oregon rose from 9% and 12% to 14% and 17%, DC fell from 100% to 85% for families, and South Carolina added the $200 cap.

Left out: New York reduces its credit by the household credit (a small low-income credit we also leave out, so the two roughly cancel), Virginia's $300 per person alternative for incomes under the poverty line, Minnesota's and Oklahoma's extras (older children, the prior-year lookback), and Washington's Working Families Tax Credit, which is paid by separate application and is in the Washington notes.

What the calculator cannot see: children are the ones entered as under 17, where the credit also covers 17 and 18-year-olds and students under 24. Investment income limits are not checked. Earned income is taken as wages after pre-tax deductions.

To recheck when the booklets come out: California's 2026 table, DC's 2026 phase-out threshold for filers without children, and whether DC's permanent budget act kept the 85%.

### Income-based phase-outs (done)

Deductions, exemptions and credits that change with income are encoded as schedules (`phaseOut` on a standard deduction or exemption, `taxAdjustments` for changes to the tax itself). `schedule.ts` holds the one function that defines how a schedule is read, and the engine should call it.

- **Encoded:** AL (standard deduction, dependent exemption), AZ (dependent credit), CT (exemption, add-back, recapture, personal tax credit), MD (exemption), ME (standard deduction, filer exemption), MN (standard deduction, dependent exemption), NC (child deduction), NM (low-income exemption), OH (exemption tiers), RI (standard deduction, exemptions), SC (standard deduction), UT (taxpayer credit), WI (standard deduction).
- **Checked:** each schedule against the official chart or formula at its boundaries. Connecticut end to end: tax computed from the file matches the state's printed tax tables to the dollar at 11 incomes across all three filing statuses.
- **Caveats:** ME thresholds are from PolicyEngine (maine.gov is blocked). UT and NM use 2025 thresholds. RI's step rule was read in the 2025 worksheet and applied to 2026 thresholds. AZ's table is from the 2025 instructions.

### What the schema cannot express yet

Each of these is written up per state in `rules.notes`.

- **Married couples taxed per spouse on one return** (AR, DE, DC, IA, KY, MO, MS, MT, VA, WV). The joint schedule is right for one-earner couples and too high for two-earner couples. Needs spouse income as an input.
- **A deduction for federal income tax paid** (AL, MO, OR). Depends on the federal result, so it belongs in the engine with a per-state rule.
- **Dependent amounts that depend on the dependent** (IN's extra exemption is for children under 19 or students, NM gives $4,000 for each dependent after the first, KS doubles the exemption in the year a child is born).
- **California's exemption credit phase-out** above roughly $260,000. Each credit drops by a fixed dollar amount, and the 2026 thresholds are not published until late December.
- **One-offs:** Arkansas switches bracket tables above $94,700, New York has recapture, Massachusetts lets filers deduct up to $2,000 of payroll taxes, Ohio has a joint filing credit.

Sync behavior:

- Runs on app startup and from a manual button.
- UI shows last synced time, dataset version, and tax year next to the button.
- App ships with seed data so it works offline on first run.
- Downloads are schema-validated, then swapped in inside one transaction. A failed or bad sync leaves the existing data alone and shows the error.

### Tables

- `tax_year`: year, dataset version
- `jurisdiction`: federal, each state, DC
- `bracket`: jurisdiction, year, filing status, lower bound, rate
- `parameter`: jurisdiction, year, filing status, key, value (standard deduction, exemptions, wage base, contribution limits, phase-out ranges, credit amounts)
- `state_rule`: per-state flags for quirks (see below)
- `sync_log`: timestamp, version, status, error
- `profile`: saved user inputs and scenarios

## Independent check against PolicyEngine (`oracle/`)

`oracle/.venv/bin/python oracle/compare.py` runs 575 households (11 household types in every state, plus 401k and HSA cases in seven states) through both our engine and PolicyEngine US, an independent open-source tax model, and prints where they differ by more than $2. Setup is `python3 -m venv oracle/.venv` then `oracle/.venv/bin/pip install policyengine-us`. The full report lands in `oracle/out/report.json`.

Result on 2026-11-12, PolicyEngine US 2.118.6, after the gaps below were closed:

- **Payroll tax:** 575 of 575 match.
- **Federal income tax:** 558 of 575 match. Eleven of the rest are Alaska, where PolicyEngine adds the Permanent Fund Dividend as income. The others are high earners whose itemized state tax differs slightly because the state figures differ.
- **State income tax:** 482 of 575 match, and 39 jurisdictions match in every case. No difference has traced to a mistake in our engine or our figures.

The first run matched 432 state cases. It sized several rules we had left out, and these are now modeled and match PolicyEngine:

- **Federal income tax deducted from state income:** Alabama (all of it), Missouri (a share that falls with income), Oregon (up to a cap that shrinks at higher incomes).
- **Payroll tax deducted from state income:** Alabama (in place of the standard deduction when larger), Massachusetts (up to $2,000).
- **New York's tax benefit recapture** on AGI over $107,650.
- **Colorado's add-back** of federal deductions at $300,000 and above.
- **Itemizing state income tax on the federal return** when it beats the standard deduction, with the cap and its phase-out.
- **Idaho's grocery credit** of $155 per person.

These rules are taken from PolicyEngine's parameter files, which cite the official forms, and are marked `secondary` until read in the state's own publication.

Why the remaining cases differ:

- **DC's child tax credit**, which PolicyEngine includes and we do not, because the law behind it was disapproved by Congress and has expired ($780 to $1,042 in the two family cases). New Mexico's $4,000 deduction for each dependent after the first is also missing (about $200).
- **Child credits where we hold 2025 figures** and PolicyEngine projects 2026: Maine and New Mexico differ by $5 to $9.
- **Arkansas's second bracket table** above $94,700 ($285 too low).
- **Our figures are newer or more official.** California and Oregon (PolicyEngine projects 2026, we use the published figures).
- **Our figures are older.** DC, MD, UT, VT, SC use some 2025 values because 2026 is not published. Differences are $2 to $35.
- **PolicyEngine simplifies.** It taxes 401k contributions in New Jersey and not in Pennsylvania. Both are the reverse of what the states publish (2025 NJ-1040 instructions, Pennsylvania's Personal Income Tax Guide), so ours are kept.
- **PolicyEngine assumes different households.** It gives lower earners a marketplace premium credit unless told they have employer coverage (the harness now tells it), and in DC it drops the standard deduction for a filer who itemizes federally.

`oracle/.venv/bin/python oracle/children.py` checks the rules for children on their own. It runs five families in every state with 16-year-olds and then with younger children, and compares how far state tax moves, so only age rules show up. 1,257 of 1,275 cases agree. The 18 that do not are California, Maine and Oregon, where we hold 2025 figures and PolicyEngine projects 2026. It also compares the level of tax for those families, where 410 of 510 match. The rest are mostly at $30,000, from low-income credits and exemptions we do not model.

`oracle/.venv/bin/python oracle/eitc.py` compares the earned income credit itself for 13 lower-income households in every state. The federal credit matches in all 13. The state credit matches in 635 of 663 cases. The 28 that do not: California (2025 figures against projected 2026, within about 5%), New York (the household credit reduction), Virginia (its alternative low-income credit), Washington (not an income tax credit) and one Utah case that is $19 off because of the older thresholds in its taxpayer credit.

## App (`web/`)

Next.js app, run with `npm run dev` from the repo root. The repo is one npm workspace (`dataset`, `engine`, `web`).

- **Database:** SQLite through Node's built-in `node:sqlite`, at `web/data/tax.db`. No ORM and no native dependency. Each year's validated bundle is stored whole in `tax_bundle`, with `sync_log` and `profile` beside it. This replaces the normalized tables and Drizzle named earlier in this plan: the engine reads the bundle as one document, so splitting it up would only mean reassembling it.
- **Sync:** `src/server/sync.ts`. Runs at server start (`src/instrumentation.ts`) and from the Sync now button. Reads `manifest.json`, downloads only changed years, checks each file's hash and schema, then writes in one transaction. A failed sync leaves stored data alone and shows the error.
- **Source:** the `TAX_DATA_URL` environment variable when set (the folder holding `manifest.json`), otherwise `dataset/dist` in this repo. Nothing is hosted on GitHub yet, so today it syncs locally.
- **UI:** `src/components/`. The engine runs in the browser, so results update as you type. Inputs are saved to the database and restored on reload.
- **Done:** inputs, summary, pay by period, where each dollar goes, bracket tables, raise or cut comparison, state comparison with pinning, tax curve and marginal rate charts, state notes, sync status.
- **State notes:** each state's `rules.notes` is written for the person using the app and shown as is. Sourcing and to-dos live in `rules.maintainerNotes`, which the app never shows.
- **Schema changes:** `SCHEMA_VERSION` in `dataset/schema.ts` goes up whenever older data would no longer fit. Stored data is checked against the schema on every read. If it does not fit, the page asks for a sync instead of failing.
- **Not done:** tax year selector (only 2026 exists), hosting the dataset on GitHub.

## Engine (`engine/`)

A pure TypeScript library. `calculate(profile, data)` takes a profile and a year's dataset bundle and returns the full breakdown. No I/O, no dependencies at runtime beyond `dataset/schedule.ts`.

- `src/calculate.ts`: orchestrates gross pay, contributions, federal, payroll and state tax, and totals.
- `src/federal.ts`, `src/state.ts`, `src/contributions.ts`, `src/income.ts`, `src/brackets.ts`: the pieces.
- `src/derive.ts`: `perPeriod`, `applyChange` (raise or cut), `marginalRate`, `compareStates`, `taxCurve`.
- `src/types.ts`: `Profile` (inputs) and `Breakdown` (outputs). The UI builds against these.
- `npm test` runs 204 tests. Federal cases are worked by hand from the IRS figures. State cases include the cumulative amounts printed in California's schedules and 11 figures from Connecticut's printed tax tables. Every state is swept across incomes and filing statuses for sane output.

Simplifications in the engine, beyond the data limits listed above:

- The earned income credit counts the children entered as under 17, uses the filer's own age for the 25 to 64 test, and takes earned income as wages after pre-tax deductions. Investment income limits are not checked. Where a state lets the filer choose a refundable or nonrefundable credit, the engine takes whichever leaves less tax.
- State credits for children count only the children under 17 that the form asks about. Minnesota's also covers 17-year-olds, and Massachusetts's and Maryland's also cover some disabled or older dependents.
- Oklahoma's 5% is taken on the federal child tax credit. Where the federal form limits the child credit and the credit for other dependents together, the limit is shared between them in proportion.
- Income used for IRA limits is AGI before the IRA deduction. The joint-filer rule for a spouse covered by a workplace plan is not applied.
- The extra standard deduction at 65 is applied for the filer only. The temporary $6,000 senior deduction is not included.
- All overtime hours are assumed to qualify for the federal overtime deduction.
- The refundable part of the child tax credit uses the 15% of earnings over $2,500 rule, which is in the dataset as unverified.
- States that start from federal taxable income inherit the federal overtime deduction. Whether each one allows it is not checked.
- The federal return takes the standard deduction, or state income tax itemized when that is larger. Other itemized deductions (property tax, mortgage interest, charity) are not asked for.
- Federal and state tax are solved together, because itemizing makes federal tax depend on state tax and three states deduct federal tax.

## Inputs

- Income: annual salary, or hourly rate with hours per week, weeks per year, and overtime hours
- Bonus and other taxable compensation
- State, filing status, age, number of dependents (children under 17 and other), and each child's age. A child with no age entered is taken to be 10.
- Tax year
- Contributions, each as a dollar amount or percent of pay:
  - Traditional 401k, Roth 401k
  - Traditional IRA, Roth IRA
  - HSA (self or family coverage)
  - Health premiums, FSA, commuter
- Employer side: 401k match formula (for example 100% of the first 4%), employer HSA contribution, other compensation
- Scenario: increase or decrease by a dollar or percent amount, applied to annual or hourly

## Calculation order

1. Gross income from salary or hourly inputs, plus bonus.
2. Pre-tax deductions, each with its own treatment:
   - Traditional 401k reduces income tax wages but not Social Security or Medicare wages.
   - HSA and health premiums through payroll reduce both.
   - Traditional IRA is an above-the-line deduction, not a payroll one, and phases out by income when there is a workplace plan.
   - Roth contributions reduce take-home but not tax. Roth IRA eligibility phases out at higher incomes.
3. Contribution limits and age-based catch-ups, with warnings when an input goes over. Employer HSA money counts toward the HSA limit. Employer match does not count toward the employee 401k limit.
4. FICA: Social Security up to the wage base, Medicare, and the additional Medicare tax above the threshold.
5. Federal income tax: adjusted gross income, minus standard deduction, through the brackets, minus credits (child tax credit and other dependent credit, with their phase-outs). Includes the overtime premium deduction that applies for 2025 through 2028.
6. State income tax: state brackets, standard deduction, personal and dependent exemptions, with per-state quirks applied.
7. Net = gross minus all taxes minus all employee contributions and premiums.

Total compensation is shown separately: gross plus employer match, employer HSA, and other employer-paid amounts.

### State quirks tracked in `state_rule`

- No wage income tax (nine states)
- HSA contributions taxed at the state level (California, New Jersey)
- 401k contributions taxed at the state level (Pennsylvania)
- No IRA deduction (Massachusetts, New Jersey, Pennsylvania)
- Health premiums and flexible spending taxed (New Jersey), commuter benefits taxed (New Jersey, Pennsylvania)
- Whether the state starts from federal AGI, federal taxable income, or its own definition
- A note flag for states with significant local or state payroll taxes we are not modeling

## UI

### Inputs panel
Everything in the inputs list, with dollar/percent toggles and inline limit warnings.

### Pay breakdown
Gross and net side by side for hourly, daily, weekly, biweekly, semi-monthly, monthly, quarterly, and yearly. Daily assumes 5 working days a week unless changed.

### Tax breakdown
- Where each gross dollar goes: federal income tax, state income tax, Social Security, Medicare, retirement and benefit contributions, take-home. Shown as amounts and as percent of gross.
- Federal and state bracket tables showing how much income fell in each bracket and the tax from it.
- Effective and marginal rates for federal, state, and combined.

### Scenario comparison
Base and scenario side by side across every figure above, with deltas. Includes a plain "of this $X raise you keep $Y" line.

### State comparison
- Runs the same profile through every state.
- Sortable table and bar chart: state tax, total tax, net take-home, and difference from the home state.
- Pin two or three states for a detailed side-by-side.
- Labeled as income tax only. Sales tax, property tax, local income taxes, and cost of living are not part of it, so a no-income-tax state is not automatically cheaper overall.

### Tax curve chart
Total tax against income as a stacked area (federal, state, FICA), with:
- Markers at bracket thresholds, the Social Security wage base, the additional Medicare threshold, and credit or deduction phase-outs
- A marginal rate step line
- Pins for the base and scenario incomes

### Sync status
Last synced time, dataset version, tax year, sync button, error state.

## Known limits, shown in the UI

- This computes annual tax liability spread evenly across pay periods. Actual paycheck withholding differs, especially on bonuses.
- Local income taxes and state payroll taxes (SDI, paid leave programs) are not included in v1. Affected states show a note.
- For married filing jointly, results assume the entered income is the whole household's unless spouse income is added.
- Standard deduction, except that state income tax is itemized on the federal return when that is larger. No other itemizing in v1.
- A few state rules are still not modeled (see the dataset section). Affected states show a note.
- Estimate only, not tax advice.

## Build order

1. ~~Data source spike: confirm source formats, define the dataset schema, build the first tax year for federal plus a handful of states.~~ Done.
2. ~~Tax engine with tests: federal and FICA first, then contributions and limits, then dependents and credits.~~ Done.
3. ~~State engine.~~ Done, including phase-outs and tax adjustments. The independent check against PolicyEngine is done (see that section). The gaps it sized are closed, the per-state rule flags are verified, and state credits for children and the earned income credit are in. Left over from this step: upgrading the six secondary states.
4. DB, seed data, and sync with status UI.
5. Inputs panel and pay breakdown.
6. Tax breakdown.
7. Scenario comparison.
8. State comparison.
9. Tax curve chart.
10. Saved profiles, limit warnings, state notes.

## Later

- State payroll taxes. The 2026 rates and wage caps for all 16 states are already in the state notes with sources, so this is mostly a schema field and a line in the engine. Worth $2,340 a year for a Californian on $180,000.
- Local taxes (NYC and similar)
- Itemized deductions
- Spouse income as a separate input with its own contributions
- Saver's credit
- Other low-income rules: state household, renter and sales tax credits, and the low-income exemptions and tax tables in states such as Arkansas, Iowa, Kentucky, Massachusetts and Virginia
- Self-employment income
