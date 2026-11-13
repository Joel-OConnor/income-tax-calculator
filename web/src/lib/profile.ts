import { z } from "zod";
import type { PayChange, Profile } from "@engine";

const amount = z.strictObject({
  kind: z.enum(["dollars", "percent"]),
  value: z.number().finite().nonnegative(),
});
const count = z.number().int().min(0).max(20);
const money = z.number().finite().nonnegative();

/** Validates a profile read back from storage, so a bad save cannot break the page. */
export const ProfileSchema = z.strictObject({
  state: z.string().regex(/^[A-Z]{2}$/),
  filingStatus: z.enum(["single", "mfj", "hoh"]),
  age: z.number().int().min(14).max(110),
  dependents: z.strictObject({
    children: count,
    other: count,
    childAges: z.array(z.number().int().min(0).max(16)).max(20).optional(),
  }),
  income: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("salary"),
      annual: money,
      hoursPerWeek: z.number().positive().max(168).optional(),
      weeksPerYear: z.number().positive().max(52).optional(),
    }),
    z.strictObject({
      kind: z.literal("hourly"),
      rate: money,
      hoursPerWeek: z.number().positive().max(168),
      weeksPerYear: z.number().positive().max(52),
      overtimeHoursPerWeek: z.number().nonnegative().max(128).optional(),
      overtimeMultiplier: z.number().min(1).max(5).optional(),
    }),
  ]),
  bonus: money,
  contributions: z.strictObject({
    traditional401k: amount,
    roth401k: amount,
    traditionalIra: amount,
    rothIra: amount,
    hsa: amount,
    hsaCoverage: z.enum(["none", "self", "family"]),
    hsaViaPayroll: z.boolean(),
    healthPremiums: amount,
    fsa: amount,
    commuter: amount,
  }),
  coveredByWorkplacePlan: z.boolean(),
  employer: z.strictObject({
    match: z.array(z.strictObject({ rate: money, upToPercent: z.number().min(0).max(100) })).max(4),
    hsa: money,
    other: money,
  }),
}) satisfies z.ZodType<Profile>;

export const ChangeSchema = z.strictObject({
  amount: z.number().finite(),
  unit: z.enum(["dollars", "percent"]),
  per: z.enum(["year", "hour"]),
}) satisfies z.ZodType<PayChange>;

/** Everything the page remembers between visits. */
export const SavedStateSchema = z.strictObject({
  profile: ProfileSchema,
  change: ChangeSchema,
  pinnedStates: z.array(z.string().regex(/^[A-Z]{2}$/)).max(3),
});
export type SavedState = z.infer<typeof SavedStateSchema>;

const none = { kind: "dollars", value: 0 } as const;

export const defaultState: SavedState = {
  profile: {
    state: "CA",
    filingStatus: "single",
    age: 35,
    dependents: { children: 0, other: 0 },
    income: { kind: "salary", annual: 85_000 },
    bonus: 0,
    contributions: {
      traditional401k: { kind: "percent", value: 6 },
      roth401k: none,
      traditionalIra: none,
      rothIra: none,
      hsa: none,
      hsaCoverage: "none",
      hsaViaPayroll: true,
      healthPremiums: { kind: "dollars", value: 2_400 },
      fsa: none,
      commuter: none,
    },
    coveredByWorkplacePlan: true,
    employer: { match: [{ rate: 0.5, upToPercent: 6 }], hsa: 0, other: 0 },
  },
  change: { amount: 10, unit: "percent", per: "year" },
  pinnedStates: [],
};
