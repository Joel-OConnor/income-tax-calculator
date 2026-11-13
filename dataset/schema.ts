import { z } from "zod";

/**
 * Raise this whenever a change to the schema means older data no longer fits
 * (a new required field, a renamed one). The app refuses stored data from
 * another version and asks for a sync instead.
 */
export const SCHEMA_VERSION = 5;

export const FILING_STATUSES = ["single", "mfj", "hoh"] as const;
export const FilingStatus = z.enum(FILING_STATUSES);

const money = z.number().nonnegative();
const rate = z.number().min(0).max(1);
const year = z.number().int().min(2020).max(2100);

/** A child's age at the end of the tax year, or the youngest age of a filer. */
const Age = z.number().int().min(0).max(25);

const perStatus = <T extends z.ZodType>(value: T) =>
  z.strictObject({ single: value, mfj: value, hoh: value });

/**
 * How much to trust a group of values:
 * - primary: read directly from the official publication it cites.
 * - secondary: from a reputable aggregator, or a summary of the official page.
 * - unverified: from general knowledge. Must be checked before release.
 */
export const Confidence = z.enum(["primary", "secondary", "unverified"]);

/** Citation fields carried by every group of values. */
const citation = {
  /** Keys into the file's `sources` map. */
  cites: z.array(z.string()).min(1),
  section: z.string().optional(),
  confidence: Confidence,
  /**
   * Set when the values are from an earlier tax year because this year's
   * were not published yet. The app should surface this to the user.
   */
  valuesTaxYear: year.optional(),
  note: z.string().optional(),
};

const group = <S extends z.ZodRawShape>(shape: S) =>
  z.strictObject({ ...citation, ...shape });

export const Source = z.strictObject({
  name: z.string().min(1),
  url: z.url(),
});

/** A marginal bracket: `rate` applies to income above `from`, up to the next bracket's `from`. */
const Bracket = z.strictObject({
  from: money,
  rate,
  /**
   * Flat amount of tax added in full once taxable income is above `from`.
   * For taxes with a cliff, like Ohio's "$332 plus 2.75% of the excess".
   */
  lumpSum: money.optional(),
});

const Brackets = z
  .array(Bracket)
  .min(1)
  .refine(
    (b) => b[0].from === 0 && b.every((x, i) => i === 0 || x.from > b[i - 1].from),
    { error: "brackets must start at 0 and have ascending lower bounds" },
  );

/** A phase-out range: [starts, fully phased out]. */
const Range = z
  .tuple([money, money])
  .refine(([start, end]) => start < end, { error: "range start must be below its end" });

const SchedulePoint = z.strictObject({ income: money, value: z.number().nonnegative() });

const SchedulePoints = z
  .array(SchedulePoint)
  .min(1)
  .refine((p) => p.every((x, i) => i === 0 || x.income > p[i - 1].income), {
    error: "schedule points must have ascending incomes",
  });

/**
 * How a deduction, exemption or credit changes with income. The meaning of
 * `points` is defined by scheduleValue() in schedule.ts.
 */
const scheduleShape = {
  /** Which income figure the schedule is read against. */
  basis: z.enum(["federal_agi", "state_agi", "state_taxable_income"]),
  /**
   * What a point's `value` means:
   * - amount: the amount itself at that income, replacing the entered one.
   * - fraction: the share of the entered amount that remains (1 is all, 0 is none).
   * - reduction: dollars taken off the total, never below zero.
   */
  unit: z.enum(["amount", "fraction", "reduction"]),
  /** step for tiers and "per $X or part of $X" rules, linear for smooth ones. */
  interpolation: z.enum(["linear", "step"]),
  points: perStatus(SchedulePoints),
};

type ScheduleLike = {
  unit: "amount" | "fraction" | "reduction";
  interpolation: "linear" | "step";
  points: Record<"single" | "mfj" | "hoh", { income: number; value: number }[]>;
};
const allPoints = (s: ScheduleLike) => [...s.points.single, ...s.points.mfj, ...s.points.hoh];
const fractionsInRange = (s: ScheduleLike) =>
  s.unit !== "fraction" || allPoints(s).every((p) => p.value <= 1);
const stepsStartAtZero = (s: ScheduleLike) =>
  s.interpolation !== "step" ||
  [s.points.single, s.points.mfj, s.points.hoh].every((p) => p[0].income === 0);

/** A value looked up from income: one list of points per filing status. A single point is a constant. */
const Lookup = z
  .strictObject({
    basis: scheduleShape.basis,
    interpolation: scheduleShape.interpolation,
    points: scheduleShape.points,
  })
  .refine((l) => stepsStartAtZero({ ...l, unit: "amount" }), {
    error: "a step schedule's first point must have income 0",
  });

const DeductionPhaseOut = z
  .strictObject(scheduleShape)
  .refine(fractionsInRange, { error: "fraction values must be between 0 and 1" })
  .refine(stepsStartAtZero, { error: "a step schedule's first point must have income 0" });

const ExemptionPhaseOut = z
  .strictObject({
    ...scheduleShape,
    /**
     * Which amounts the schedule changes. With unit `amount`, `filer` means the
     * filer total for that status and `dependent` means the per-dependent amount.
     * With unit `reduction`, the dollars come off the total of everything covered.
     */
    appliesTo: z.enum(["all", "filer", "dependent"]),
  })
  .refine(fractionsInRange, { error: "fraction values must be between 0 and 1" })
  .refine(stepsStartAtZero, { error: "a step schedule's first point must have income 0" })
  .refine((s) => !(s.unit === "amount" && s.appliesTo === "all"), {
    error: "unit `amount` needs appliesTo `filer` or `dependent`, not `all`",
  });

export const Federal = z.strictObject({
  taxYear: year,
  jurisdiction: z.literal("federal"),
  sources: z.record(z.string(), Source),

  incomeTax: z.strictObject({
    brackets: group(perStatus(Brackets).shape),
    standardDeduction: group(perStatus(money).shape),
    /** Extra standard deduction per person who is 65+ or blind. */
    additionalStandardDeduction: group({ married: money, unmarried: money }),
  }),

  credits: z.strictObject({
    childTaxCredit: group({ perChild: money, refundableMax: money }),
    /**
     * How much of the child tax credit can be refunded beyond the tax owed:
     * `rate` of earned income above `earnedIncomeOver`, up to `refundableMax` per child.
     */
    refundableChildTaxCredit: group({ earnedIncomeOver: money, rate }),
    otherDependentCredit: group({ perDependent: money }),
    /**
     * Earned income credit: `phaseInRate` of earned income up to `maxCredit`, less
     * `phaseOutRate` of income over `phaseOutStart`. `byChildren` has four entries,
     * for no, one, two, and three or more qualifying children.
     */
    earnedIncomeCredit: group({
      byChildren: z
        .array(
          z.strictObject({
            phaseInRate: rate,
            /** Earned income at which the credit reaches its maximum. */
            earnedIncomeAmount: money,
            maxCredit: money,
            phaseOutRate: rate,
            phaseOutStart: z.strictObject({ mfj: money, other: money }),
          }),
        )
        .length(4),
      /** A filer with no qualifying child must be within these ages at the end of the year. */
      childlessMinAge: Age,
      childlessMaxAge: z.number().int(),
    }),
    /** Applies to the child and other-dependent credits combined. */
    dependentCreditPhaseOut: group({
      start: perStatus(money),
      /** Dollars of credit lost per $1,000 (or part of $1,000) of income over `start`. */
      reductionPer1000: money,
    }),
  }),

  deductions: z.strictObject({
    /** Deduction for the premium portion of FLSA overtime. */
    overtime: group({
      max: perStatus(money),
      phaseOutStart: perStatus(money),
      reductionPer1000: money,
      firstTaxYear: year,
      lastTaxYear: year,
    }),
  }),

  /**
   * Itemizing. The engine itemizes only state income tax, and only when that
   * beats the standard deduction.
   */
  itemized: z.strictObject({
    stateAndLocalTax: group({
      cap: perStatus(money),
      /** The cap shrinks by `phaseOutRate` of income above `phaseOutStart`, but not below `floor`. */
      phaseOutStart: perStatus(money),
      phaseOutRate: rate,
      floor: money,
    }),
  }),

  fica: z.strictObject({
    socialSecurity: group({ rate, wageBase: money }),
    medicare: group({ rate }),
    additionalMedicare: group({ rate, threshold: perStatus(money) }),
  }),

  contributionLimits: z.strictObject({
    k401: group({
      employeeDeferral: money,
      catchUp50: money,
      catchUp60to63: money,
    }),
    ira: group({
      limit: money,
      catchUp50: money,
      /** MAGI ranges over which the traditional IRA deduction phases out. */
      traditionalDeductionPhaseOut: z.strictObject({
        coveredByWorkplacePlan: perStatus(Range),
        /** Contributor not covered, spouse is. Joint filers only. */
        spouseCoveredOnly: z.strictObject({ mfj: Range }),
      }),
      /** MAGI ranges over which Roth IRA eligibility phases out. */
      rothPhaseOut: perStatus(Range),
    }),
    hsa: group({ selfOnly: money, family: money, catchUp55: money }),
    healthFsa: group({ limit: money }),
    commuter: group({ monthlyTransit: money, monthlyParking: money }),
  }),
});

const StateRules = group({
  /** State taxes wages that went into a traditional 401k (federal does not). */
  taxes401kContributions: z.boolean(),
  /** State taxes HSA contributions (federal does not). */
  taxesHsaContributions: z.boolean(),
  /** State gives no deduction for traditional IRA contributions (federal does). */
  taxesIraContributions: z.boolean(),
  /** State taxes health, dental and vision premiums paid pre-tax through a cafeteria plan. */
  taxesHealthPremiums: z.boolean(),
  /** State taxes health flexible spending account contributions. */
  taxesFsaContributions: z.boolean(),
  /** State taxes transit and parking benefits taken by salary reduction. */
  taxesCommuterBenefits: z.boolean(),
  /** Cities or counties levy their own income tax. Not modeled in v1. */
  hasLocalIncomeTaxes: z.boolean(),
  /** State withholds its own payroll tax from employees (disability, paid leave). Not modeled in v1. */
  hasStatePayrollTax: z.boolean(),
  /** Shown to the person using the calculator. Plain statements, no sourcing or to-dos. */
  notes: z.array(z.string()),
  /** For whoever maintains the data: where a note came from, what to recheck and when. */
  maintainerNotes: z.array(z.string()).default([]),
});

/**
 * A change to the tax itself, looked up by income: recapture amounts, add-backs,
 * and credits that are a percentage of tax. `points` follow scheduleValue().
 * The engine applies every `add` first, then every `creditFraction`:
 *   tax = (bracket tax + surtaxes + sum of adds) x (1 - sum of credit fractions)
 */
const TaxAdjustment = z
  .strictObject({
    ...citation,
    name: z.string().min(1),
    /** add: `value` is dollars added to tax. creditFraction: `value` is the share of tax removed. */
    effect: z.enum(["add", "creditFraction"]),
    basis: scheduleShape.basis,
    interpolation: scheduleShape.interpolation,
    points: scheduleShape.points,
  })
  .refine((a) => a.effect !== "creditFraction" || fractionsInRange({ ...a, unit: "fraction" }), {
    error: "creditFraction values must be between 0 and 1",
  })
  .refine((a) => stepsStartAtZero({ ...a, unit: "amount" }), {
    error: "a step schedule's first point must have income 0",
  });

/** Income a child credit can be measured against. `earned_income` is wages subject to federal income tax. */
const CreditBasis = z.enum(["federal_agi", "state_agi", "state_taxable_income", "earned_income"]);

/**
 * A credit for children, on top of any dependent exemption. The engine works it out as:
 *   1. Each child under 17 gets the amount of the first band that holds their age.
 *      `amountByIncome` replaces that amount with one looked up from income.
 *   2. Only the `maxChildren` largest amounts count. `per: return` keeps just the largest one.
 *   3. `perOtherDependent` is added for each dependent who is not a child under 17,
 *      and `earnedIncomeAddOn` once per return when a child qualifies.
 *   4. `phaseOut` takes dollars off as income rises, and `incomeLimit` removes the credit above it.
 *   5. `federalCreditShare` adds that share of the federal child tax credit (no bands needed).
 * A nonrefundable credit stops at zero tax. A refundable one is paid out past it.
 */
const ChildCredit = z
  .strictObject({
    ...citation,
    name: z.string().min(1),
    refundable: z.boolean(),
    /** Dollars per child by age: `fromAge` and older, younger than `underAge`. */
    bands: z
      .array(z.strictObject({ fromAge: Age, underAge: Age, amount: money }))
      .default([]),
    /** Dollars per child looked up from income, as steps. Replaces the band amount. Needs exactly one band. */
    amountByIncome: z
      .strictObject({ basis: CreditBasis, points: perStatus(SchedulePoints) })
      .optional(),
    perOtherDependent: money.optional(),
    /**
     * Added once per return when at least one child qualifies, before the phase-out:
     * `rate` of earned income up to `upTo` (Minnesota's working family credit,
     * which is phased out together with its child credit).
     */
    earnedIncomeAddOn: z.strictObject({ rate, upTo: money }).optional(),
    per: z.enum(["child", "return"]).default("child"),
    maxChildren: z.number().int().positive().optional(),
    /** The credit is this share of the federal child tax credit the filer gets. */
    federalCreditShare: rate.optional(),
    /**
     * One credit per return, this share of the state's earned income credit, when
     * at least one child falls in `bands`. The band amounts are not used (Illinois).
     */
    earnedIncomeCreditShare: rate.optional(),
    /** No credit when income is above this. */
    incomeLimit: z.strictObject({ basis: CreditBasis, ...perStatus(money).shape }).optional(),
    /**
     * The credit loses `amount` dollars for every `per` dollars of income above `start`.
     * `rounding` says how a part of `per` counts: `up` for "or part of" rules where any
     * fraction counts in full, `down` when only whole steps count, `none` for a smooth reduction.
     * `appliesTo: each` takes it off every child's amount, `total` off the sum.
     */
    phaseOut: z
      .strictObject({
        basis: CreditBasis,
        start: perStatus(money),
        amount: z.number().positive(),
        per: z.number().positive(),
        rounding: z.enum(["up", "down", "none"]),
        appliesTo: z.enum(["each", "total"]),
      })
      .optional(),
  })
  .refine((c) => c.bands.every((b) => b.fromAge < b.underAge), {
    error: "a band's fromAge must be below its underAge",
  })
  .refine((c) => c.bands.length > 0 || c.federalCreditShare !== undefined, {
    error: "a child credit needs bands or a federalCreditShare",
  })
  .refine((c) => !c.amountByIncome || c.bands.length === 1, {
    error: "amountByIncome needs exactly one band",
  })
  .refine(
    (c) =>
      !c.amountByIncome ||
      [c.amountByIncome.points.single, c.amountByIncome.points.mfj, c.amountByIncome.points.hoh].every(
        (p) => p[0].income === 0,
      ),
    { error: "amountByIncome points must start at income 0" },
  );

/** One value for each number of qualifying children: none, one, two, three or more. */
const byChildren = <T extends z.ZodType>(value: T) => z.array(value).length(4);

/**
 * The state's earned income credit. Usually a share of the federal credit (`match`).
 * A state with its own formula gives `schedule` instead: the credit by earned income,
 * straight lines between points. Where both are given for a number of children, the
 * schedule wins, so a state can match the federal credit for families and run its own
 * formula for filers without children.
 */
const StateEarnedIncomeCredit = z
  .strictObject({
    ...citation,
    name: z.string().min(1),
    refundable: z.boolean(),
    /** Share of the federal earned income credit. Can be above 1. */
    match: byChildren(z.number().nonnegative()).optional(),
    /** A nonrefundable share the filer may take instead. The engine uses whichever leaves less tax. */
    nonrefundableMatch: byChildren(z.number().nonnegative()).optional(),
    /** Share used for every child count when the youngest child is under `underAge` (Oregon). */
    youngChildMatch: z.strictObject({ underAge: Age, match: z.number().nonnegative() }).optional(),
    schedule: byChildren(perStatus(SchedulePoints).nullable()).optional(),
    /** Flat dollars added for a filer who gets the credit and has at least one qualifying child (Connecticut). */
    withChildAddOn: money.optional(),
    /** The most the credit can be (South Carolina). */
    cap: money.optional(),
    /** Ages a filer with no qualifying child must be within, when they differ from the federal ones. Null for no upper limit. */
    childlessMinAge: Age.optional(),
    childlessMaxAge: z.number().int().nullable().optional(),
    /**
     * True when a filer who qualifies only because of the state's wider ages gets the
     * match on the federal maximum for no children, whatever their income (New Jersey).
     */
    widerAgesGetMaximum: z.boolean().optional(),
  })
  .refine((c) => c.match !== undefined || c.schedule !== undefined, {
    error: "an earned income credit needs a match or a schedule",
  });

const NoIncomeTax = z.strictObject({
  type: z.literal("none"),
  ...citation,
});

const BracketedIncomeTax = z.strictObject({
  type: z.literal("bracketed"),
  /** What the state's taxable income calculation starts from. */
  startingPoint: z.enum(["federal_agi", "federal_taxable_income", "state_gross_income"]),
  /** A flat tax is a single bracket. */
  brackets: group(perStatus(Brackets).shape),
  /** Extra tax on income above a threshold, on top of the brackets. */
  surtaxes: z.array(group({ name: z.string(), rate, over: perStatus(money) })),
  /** Income-keyed additions to tax and percentage credits. Usually empty. */
  taxAdjustments: z.array(TaxAdjustment).default([]),
  /**
   * The state lets filers deduct federal income tax (after credits) from
   * state income: `share` of it, up to `cap` dollars when a cap is given.
   */
  federalTaxDeduction: group({ share: Lookup, cap: Lookup.optional() }).optional(),
  /**
   * Health premiums the state taxed (rules.taxesHealthPremiums) count as medical
   * expenses, deductible above `incomeFloor` as a share of state gross income
   * (New Jersey, 2%). No other medical expense is modeled.
   */
  medicalExpenseDeduction: group({ incomeFloor: rate }).optional(),
  /** A deduction for the Social Security and Medicare tax the filer paid. */
  payrollTaxDeduction: group({
    /**
     * insteadOfStandardDeduction: an itemized deduction, used when it beats the standard deduction.
     * additional: taken on top of the standard deduction.
     */
    mode: z.enum(["insteadOfStandardDeduction", "additional"]),
    capPerEarner: money.optional(),
  }).optional(),
  /**
   * Takes back the benefit of the lower brackets from higher earners (New York).
   * Extra tax = base + increment x (share of `phaseInLength` that AGI is above
   * the larger of `minAgi` and the start of the filer's bracket), where base and
   * increment come from the last level whose `over` is at or below taxable
   * income. Above the top bracket's threshold of AGI, all taxable income is
   * taxed at the top rate instead.
   */
  benefitRecapture: group({
    minAgi: money,
    phaseInLength: z.number().positive(),
    levels: perStatus(
      z.array(z.strictObject({ over: money, base: money, increment: money })).min(1),
    ),
  }).optional(),
  earnedIncomeCredit: StateEarnedIncomeCredit.optional(),
  /** Credits for children that depend on age or income. Usually empty. */
  childCredits: z.array(ChildCredit).default([]),
  /**
   * Null when the state has none, or when it is already inside the starting point.
   * The amounts are the full ones, before any `phaseOut`.
   */
  standardDeduction: group({
    ...perStatus(money).shape,
    phaseOut: DeductionPhaseOut.optional(),
  }).nullable(),
  personalExemption: group({
    /** A deduction reduces taxable income. A credit reduces tax. */
    kind: z.enum(["deduction", "credit"]),
    single: money,
    mfj: money,
    hoh: money,
    dependent: money,
    /** `children` when the dependent amount is only for children who qualify for the federal child tax credit. Defaults to `all`. */
    dependentsCounted: z.enum(["all", "children"]).optional(),
    /** Set when the dependent amount is a different kind from the filer's. Defaults to `kind`. */
    dependentKind: z.enum(["deduction", "credit"]).optional(),
    /** Amount for a dependent who is not a child under 17, when it differs from `dependent`. */
    otherDependent: money.optional(),
    /** An extra amount, of the dependent's kind, for each child younger than `underAge`. */
    youngChild: z.strictObject({ underAge: Age, amount: money }).optional(),
    /** Exemption is lost entirely above this AGI. */
    agiLimit: perStatus(money).optional(),
    /** The amounts above are the full ones, before this is applied. */
    phaseOut: ExemptionPhaseOut.optional(),
  }).nullable(),
});

export const State = z.strictObject({
  taxYear: year,
  jurisdiction: z.string().regex(/^[A-Z]{2}$/),
  name: z.string().min(1),
  sources: z.record(z.string(), Source),
  incomeTax: z.discriminatedUnion("type", [NoIncomeTax, BracketedIncomeTax]),
  rules: StateRules,
});

/** One tax year, federal plus every state we have, as the app syncs it. */
export const Bundle = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  taxYear: year,
  federal: Federal,
  states: z.record(z.string(), State),
});

export const Manifest = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  years: z.array(
    z.strictObject({
      taxYear: year,
      file: z.string(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      states: z.array(z.string()),
    }),
  ),
});

export type FilingStatus = z.infer<typeof FilingStatus>;
export type Confidence = z.infer<typeof Confidence>;
export type Federal = z.infer<typeof Federal>;
export type State = z.infer<typeof State>;
export type Bundle = z.infer<typeof Bundle>;
export type Manifest = z.infer<typeof Manifest>;
