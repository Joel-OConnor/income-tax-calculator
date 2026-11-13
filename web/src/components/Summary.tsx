"use client";

import type { Breakdown } from "@engine";
import { pct, signedUsd, usd } from "@/lib/format";

interface Props {
  base: Breakdown;
  scenario: Breakdown;
  baseMarginal: number;
  hasChange: boolean;
}

export function Summary({ base, scenario, baseMarginal, hasChange }: Props) {
  const grossChange = scenario.gross.total - base.gross.total;
  const netChange = scenario.totals.takeHome - base.totals.takeHome;
  const kept = grossChange !== 0 ? netChange / grossChange : 0;
  const raise = grossChange >= 0;

  return (
    <>
      <section className="summary" aria-label="Summary">
        <div className="card tile hero">
          <span className="label">Take-home pay a year</span>
          <span className="value">{usd(base.totals.takeHome)}</span>
          <span className="delta">
            {usd(base.totals.takeHome / 12)} a month, from {usd(base.gross.total)} gross
          </span>
        </div>
        <div className="card tile">
          <span className="label">Total tax</span>
          <span className="value">{usd(base.totals.tax)}</span>
          <span className="delta">{pct(base.totals.effectiveRate)} of gross pay</span>
        </div>
        <div className="card tile">
          <span className="label">Tax on your next dollar</span>
          <span className="value">{pct(baseMarginal)}</span>
          <span className="delta">Federal, payroll and state combined</span>
        </div>
        <div className="card tile">
          <span className="label">Saved and spent before pay</span>
          <span className="value">{usd(base.totals.employeeContributions)}</span>
          <span className="delta">Retirement, health and benefits</span>
        </div>
        <div className="card tile">
          <span className="label">Total compensation</span>
          <span className="value">{usd(base.totals.totalCompensation)}</span>
          <span className="delta">
            {usd(base.totals.totalCompensation - base.gross.total)} from your employer
          </span>
        </div>
      </section>

      {hasChange && grossChange !== 0 && (
        <p className="callout">
          With the {raise ? "raise" : "cut"}, gross pay goes {raise ? "up" : "down"} by{" "}
          <strong>{usd(Math.abs(grossChange))}</strong> and take-home changes by{" "}
          <strong>{signedUsd(netChange)}</strong> a year ({signedUsd(netChange / 12)} a month). You{" "}
          {raise ? "keep" : "lose"} <strong>{pct(kept, 0)}</strong> of each dollar
          {raise ? " of the raise" : " cut"}.
        </p>
      )}

      {base.warnings.length > 0 && (
        <div className="warnings" role="status">
          {base.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}
    </>
  );
}
