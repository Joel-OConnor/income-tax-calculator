import type { BracketSlice } from "./types.ts";

export interface Bracket {
  from: number;
  rate: number;
  lumpSum?: number;
}

export interface BracketResult {
  tax: number;
  slices: BracketSlice[];
  /** Rate of the highest bracket reached. */
  marginalRate: number;
}

/** Tax on `taxable` under marginal brackets, with the income and tax in each one. */
export function bracketTax(brackets: Bracket[], taxable: number): BracketResult {
  let tax = 0;
  let marginalRate = brackets[0].rate;
  const slices = brackets.map((b, i): BracketSlice => {
    const to = brackets[i + 1]?.from ?? null;
    const income = Math.max(0, Math.min(taxable, to ?? Infinity) - b.from);
    const reached = taxable > b.from;
    const sliceTax = income * b.rate + (reached ? (b.lumpSum ?? 0) : 0);
    if (reached) marginalRate = b.rate;
    tax += sliceTax;
    return { from: b.from, to, rate: b.rate, income, tax: sliceTax };
  });
  return { tax, slices, marginalRate };
}
