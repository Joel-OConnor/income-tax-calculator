export { calculate } from "./calculate.ts";
export { childAges, DEFAULT_CHILD_AGE } from "./state.ts";
export {
  applyChange,
  compareStates,
  marginalRate,
  perPeriod,
  taxCurve,
  withBasePay,
} from "./derive.ts";
export type { CurvePoint, PayChange, Periods, StateComparison } from "./derive.ts";
export type {
  Amount,
  BracketSlice,
  Breakdown,
  Bundle,
  FilingStatus,
  Income,
  MatchTier,
  Profile,
} from "./types.ts";
