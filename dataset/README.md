# Tax dataset

Hand-curated tax parameters, one folder per tax year. `npm run build` validates the source files and writes the bundle the app syncs from.

```
src/<year>/federal.json        federal figures
src/<year>/states/<ST>.json    one file per state, plus DC
schema.ts                      the shape every file must match
build.ts                       validation and bundling
dist/                          generated output, do not edit
```

## Commands

```bash
npm run build
```

```bash
node build.ts --check src/2026/states/OH.json
```

`--check` validates only the files you name and writes nothing, so it is safe while other files are mid-edit.

## Where numbers come from

In order of preference:

1. **The state's own publication**: revenue department tax rate schedules, form instructions, or statute. This is the only thing that counts as `primary`.
2. **PolicyEngine US parameter files.** Machine-readable, cover all filing statuses, and each file's `reference` entries link to the official page. Read them raw from the `main` branch:
   `https://raw.githubusercontent.com/PolicyEngine/policyengine-us/main/policyengine_us/parameters/gov/states/<st>/tax/income/...`
   The folder layout differs per state, so open the directory listing first:
   `https://github.com/PolicyEngine/policyengine-us/tree/main/policyengine_us/parameters/gov/states/<st>/tax/income`
   Values are keyed by effective date. The value for a year is the latest entry on or before January 1 of that year. A file with `uprating` metadata and no entry for the year means the value is computed, not stored, so it is not usable for that year.
3. **Tax Foundation's yearly state table.** Single and joint only, no head of household, and some rows lag a year. Cross-check only.
   `https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/`

Never fill a number from memory. If a value cannot be found, leave the nearest honest value with the right `confidence` and `valuesTaxYear`, and say so in `note`.

When two sources disagree, the state's own publication wins. Record the disagreement in `note`.

## Citation fields

Every group of values carries:

- `cites`: keys into the file's `sources` map. Every source must be cited somewhere and every cite must exist.
- `confidence`:
  - `primary`: you read these values in the official publication you cite.
  - `secondary`: from PolicyEngine, Tax Foundation, or a summary of the official page.
  - `unverified`: from general knowledge. Needs checking.
- `valuesTaxYear`: set only when the values are from an earlier year because this year's were not published. Many states index brackets yearly and publish late.
- `section`: optional pointer inside the source (table name, page, form line).
- `note`: optional. Anything a reviewer should know.

A group's confidence is that of its weakest value.

## State file conventions

**Filing statuses** are `single`, `mfj` (married filing jointly) and `hoh` (head of household). All three are always present. If the state has no separate head of household schedule, copy the schedule those filers actually use (usually single) and say so in the group's `note`.

**`incomeTax.type`** is `none` when the state does not tax wages, otherwise `bracketed`.

**`brackets`** are marginal. `from` is the lower bound of taxable income, `rate` is a decimal (4.95% is `0.0495`). The first bracket starts at 0. A flat tax is one bracket. A zero-rate first bracket is fine (for example a state that taxes nothing below a threshold). If the tax jumps by a flat amount when income crosses a threshold, put that amount in the bracket's `lumpSum` and never fold it into a made-up rate (see `OH.json`).

**`startingPoint`** is what the state's taxable income calculation begins with:
- `federal_agi`: the usual case.
- `federal_taxable_income`: the federal standard deduction is already applied. Set `standardDeduction` to `null`.
- `state_gross_income`: the state defines income itself (New Jersey, Pennsylvania).

**`standardDeduction`** is `null` when the state has none. If the state uses the federal amounts, write the numbers and note it.

**`personalExemption`** is `null` when the state has none. `kind` is `deduction` if it reduces taxable income, `credit` if it reduces tax. `single`, `mfj` and `hoh` are the total for the filer (and spouse), `dependent` is per dependent. Set `dependentKind` when dependents get a credit but filers get a deduction, or the reverse. Set `dependentsCounted` to `children` when the amount is only for children who qualify for the federal child tax credit. Set `otherDependent` when a dependent who is not a child under 17 gets a different amount (Arizona, $25). Set `youngChild` for an extra amount per child below an age (South Carolina doubles its deduction under 6). Use `agiLimit` only for a hard cutoff. Describe gradual phase-outs in `note`.

## Income-based phase-outs

When a standard deduction, exemption or exemption credit changes with income, enter the full amount (what a low-income filer gets) in the usual fields and describe the change in the group's `phaseOut`. The exact meaning of a schedule is the `scheduleValue()` function in `schedule.ts`.

- `basis`: the income the rule is written against: `federal_agi`, `state_agi` (the state's own AGI), or `state_taxable_income`.
- `unit`: what each point's `value` is.
  - `amount`: the amount itself at that income. For a standard deduction, the deduction. For an exemption with `appliesTo: "filer"`, the filer total for that status. With `appliesTo: "dependent"`, the per-dependent amount.
  - `fraction`: the share of the entered amount that remains. 1 is all of it, 0 is none.
  - `reduction`: dollars taken off the total, never below zero. Use this when the rule subtracts a percentage of income from a total that depends on family size (Utah's taxpayer credit).
- `interpolation`:
  - `step`: a point's value applies to income above its `income`. The first point must have income 0. Use for tiers and for "reduced by $X for each $Y or part of $Y" rules, listing every step. For a tier written as "$26,000 or more", use income 25999.
  - `linear`: straight lines between points, flat before the first and after the last. Use for smooth rules like "reduced by 12% of income over $20,000".
- `points`: one list per filing status, incomes ascending.
- `appliesTo` (exemptions only): `filer`, `dependent`, or `all`.

Prefer `amount` when the rule gives dollar figures and `fraction` when it gives a percentage of the deduction or exemption. Generate long step lists with a script rather than by hand, and state the underlying rule in the group's `note` so next year's update can regenerate them.

Example, an exemption of $15,000 for a single filer that drops by $1,000 for each $1,000 or part over $30,000:

```json
"phaseOut": {
  "basis": "state_agi",
  "appliesTo": "filer",
  "unit": "amount",
  "interpolation": "step",
  "points": {
    "single": [
      { "income": 0, "value": 15000 },
      { "income": 30000, "value": 14000 },
      { "income": 31000, "value": 13000 }
    ]
  }
}
```

(Shortened. The real list runs to zero and has `mfj` and `hoh` too.)

### Adjustments to the tax itself

Some states change the computed tax by an amount looked up from income: Connecticut's recapture and add-back tables add dollars, and its personal tax credit removes a percentage of the tax. These go in `incomeTax.taxAdjustments`, a list that can be left out when empty. Each entry is a cited group with a `name`, an `effect`, and the same `basis`, `interpolation` and `points` as a phase-out:

- `effect: "add"`: each point's `value` is dollars added to tax.
- `effect: "creditFraction"`: each point's `value` is the share of tax removed (0.75 means the filer pays a quarter).

The engine applies every add first, then every credit fraction.

### Credits for children

A credit for children that depends on age or income goes in `incomeTax.childCredits`, a list that can be left out when empty. A plain per-dependent amount with no age test still belongs in `personalExemption`. Each entry is a cited group:

- `name`, and `refundable`: a nonrefundable credit stops at zero tax, a refundable one is paid out past it.
- `bands`: dollars per child by age at the end of the year, each `fromAge` and older, younger than `underAge`. "Age 6 or younger" is `underAge: 7`. Only children under 17 are known to the calculator.
- `amountByIncome`: for credits printed as a table of income tiers (Colorado, New Jersey, New Mexico). `points` are steps, one list per filing status, starting at income 0. A point's value applies to income above it, so "$26,000 or less gets $1,200, then $600" is `(0, 1200), (26000, 600)`. Needs exactly one band.
- `phaseOut`: the credit loses `amount` dollars for every `per` dollars of income over `start`. `rounding` is `up` for "or fraction thereof", `down` when the form counts whole steps only (New York), `none` for a smooth cents-per-dollar rule (Utah). `appliesTo` is `each` when every child's amount shrinks (Vermont) and `total` when the sum does (New York, Maine). Read the worksheet to tell which, the statute is often unclear.
- `basis` on any of these is `federal_agi`, `state_agi`, `state_taxable_income` or `earned_income`.
- `perOtherDependent`: dollars for each dependent who is not a child under 17 (Maine).
- `earnedIncomeAddOn`: a `rate` of earned income up to `upTo`, added once per return when a child qualifies and phased out with the rest (Minnesota's working family credit).
- `maxChildren`, and `per: "return"` for one amount per return however many children qualify.
- `federalCreditShare` with `incomeLimit`: a share of the federal child tax credit, cut off above an income (Oklahoma).
- `earnedIncomeCreditShare`: one credit per return, a share of the state's earned income credit, when a child falls in `bands` (Illinois). The band amounts are zero.

The child's age is whatever the person typed. A child with no age is taken to be 10.

After adding or changing one, run `oracle/.venv/bin/python oracle/children.py`. It runs the same family with 16-year-olds and then with younger children in every state, and compares how far state tax moves here and in PolicyEngine, so only age rules show up. It also compares the level, which picks up state earned income credits we do not model, so expect differences at low incomes.

Indexed credits (Colorado's tiers, New Mexico's and Maine's amounts) are usually not published until the return booklet is out. Enter the latest published year with `valuesTaxYear` and do not enter an estimate.

### Earned income credit

`federal.json` has `credits.earnedIncomeCredit`: four rows in `byChildren` (no, one, two, three or more qualifying children) from the yearly revenue procedure, with the statutory percentages. The engine uses the formula, where the Form 1040 instructions print the credit in $50 bands, so a real return can differ by a few dollars.

A state's credit goes in `incomeTax.earnedIncomeCredit`, a cited group:

- `match`: the share of the federal credit, as four numbers for no, one, two, three or more children. Most states use one number four times. Wisconsin gives nothing without children, and a few states give childless filers more.
- `refundable`. Where the state lets the filer choose (Delaware, Maryland, Virginia), `match` is the refundable share and `nonrefundableMatch` the other one. The engine takes whichever leaves less tax.
- `youngChildMatch`: a different share when the youngest child is under an age (Oregon).
- `withChildAddOn` for a flat amount added for filers with a child (Connecticut), and `cap` for a ceiling (South Carolina).
- `childlessMinAge` and `childlessMaxAge` when the state lets filers without children claim outside the federal ages of 25 to 64. `null` for no upper limit. The match then applies to the federal credit they would have had.
- `widerAgesGetMaximum`: true when those filers get the match on the federal maximum whatever their income (New Jersey).
- `schedule`: for a state with its own formula. Four entries like `match`, each a list of points per filing status, earned income against credit, with straight lines between them. `null` for a child count that uses `match` instead.

The percent applies to the credit the engine computes for the federal return. A state that computes the federal credit under older law needs a note, since the engine does not hold old tables.

After changing one, run `oracle/.venv/bin/python oracle/eitc.py`, which compares the federal and state credit itself for 13 lower-income households in every state.

### Other state rules

Optional fields on `incomeTax`, used by a handful of states:

- `federalTaxDeduction`: the state lets filers deduct federal income tax (Alabama, Missouri, Oregon). `share` is the fraction deductible and `cap` an optional dollar limit. Each is a lookup by income with one list of points per filing status. A single point is a constant.
- `payrollTaxDeduction`: a deduction for Social Security and Medicare tax paid. `mode` is `insteadOfStandardDeduction` for an itemized deduction used when it beats the standard deduction (Alabama), or `additional` for one taken on top of it (Massachusetts). `capPerEarner` limits it.
- `medicalExpenseDeduction`: health premiums the state taxed count as medical expenses, deductible above `incomeFloor` as a share of income (New Jersey, 2%). Only premiums are counted.
- `benefitRecapture`: New York's take-back of the lower brackets from higher earners. The `base` and `increment` amounts follow from the bracket rates and thresholds, so redo them whenever those change.

`federal.json` has `itemized.stateAndLocalTax`, the cap on deducting state tax. The engine itemizes state income tax on the federal return when that beats the standard deduction, and nothing else.

Once a phase-out is encoded, remove the matching "Not modeled:" line from `rules.notes`. If a rule still does not fit, leave the full amount, keep the "Not modeled:" line, and say why.

**`surtaxes`** are extra taxes on income above a threshold on top of the brackets (California's mental health tax, Massachusetts's millionaire surtax). Empty array when none.

**`rules`** holds the flags the engine needs and free-text notes:
- `taxes401kContributions`, `taxesHsaContributions`, `taxesIraContributions`, `taxesHealthPremiums`, `taxesFsaContributions`, `taxesCommuterBenefits`: true only where the state taxes money that is pre-tax or deductible federally. Most states follow the federal treatment. The exceptions for 2026 are California (HSA), Massachusetts (IRA), New Jersey (everything but a 401k) and Pennsylvania (401k, IRA, commuter). After changing one, run `oracle/.venv/bin/python oracle/flags.py`, which compares how each kind of contribution moves state tax here and in PolicyEngine for every state.
- `hasLocalIncomeTaxes`: cities, counties or school districts levy income or wage taxes.
- `hasStatePayrollTax`: employees pay a state disability, paid leave, unemployment or similar contribution. The amounts are not computed yet, so put the rate and wage cap in `notes`. Rates change every January.
- `notes`: shown in the app to the person using it. Plain statements of fact about the state, with no sourcing, hedging or to-dos. Start with "Not modeled:" for anything that changes tax owed but is left out, such as a deduction for federal income tax paid, recapture rules, or low-income credits.
- `maintainerNotes`: never shown in the app. Where a note came from, what is unverified, and what to recheck and when ("Recheck for 2027", "From PolicyEngine, not read in the state's own instructions").

## Sanity check

Official rate schedules usually print the cumulative tax at each threshold ("$3,310.88 plus 9.3% of the amount over $75,197"). Where they do, confirm the brackets you entered reproduce the figure for the top bracket. It catches transcription slips.

See `src/2026/states/CA.json` (graduated, credits, surtax), `NY.json` (mixed sources), `CO.json` (federal taxable income start) and `TX.json` (no tax) for examples.
