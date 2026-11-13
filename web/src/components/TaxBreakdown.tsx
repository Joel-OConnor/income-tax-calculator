"use client";

import { useState } from "react";
import type { BracketSlice, Breakdown } from "@engine";
import { pct, rate, signedUsd, usd } from "@/lib/format";

interface Props {
  base: Breakdown;
  scenario: Breakdown;
  hasChange: boolean;
}

interface Part {
  key: string;
  label: string;
  color: string;
  /** Text color for a share printed inside the block. */
  ink: string;
  value: (b: Breakdown) => number;
}

// Order and colors are fixed, so a part keeps its color whatever the amounts are.
const PARTS: Part[] = [
  { key: "federal", label: "Federal income tax", color: "var(--series-1)", ink: "#fff", value: (b) => Math.max(0, b.federal.tax) },
  { key: "state", label: "State income tax", color: "var(--series-2)", ink: "#fff", value: (b) => Math.max(0, b.state.tax) },
  { key: "payroll", label: "Social Security and Medicare", color: "var(--series-3)", ink: "#fff", value: (b) => b.fica.total },
  { key: "saved", label: "Retirement, health and benefits", color: "var(--series-4)", ink: "var(--on-series-4)", value: (b) => b.totals.employeeContributions },
  { key: "home", label: "Take-home", color: "var(--series-neutral)", ink: "var(--ink)", value: (b) => Math.max(0, b.totals.takeHome) },
];

function DollarBar({ label, breakdown }: { label: string; breakdown: Breakdown }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = PARTS.map((p) => p.value(breakdown));
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;

  // Where each block starts, as a share of the bar, for placing the tooltip.
  const starts = values.map((_, i) => values.slice(0, i).reduce((a, b) => a + b, 0) / total);
  const summary = PARTS.map((p, i) => `${p.label} ${usd(values[i])}, ${pct(values[i] / total, 0)}`).join("; ");

  return (
    <div className="barrow">
      <span>{label}</span>
      <div className="segbar" role="img" aria-label={`${label}: ${summary}`}>
        {PARTS.map((part, i) => {
          const share = values[i] / total;
          if (share <= 0) return null;
          return (
            <button
              key={part.key}
              type="button"
              className="seg"
              style={{ flex: `${share} 1 0`, background: part.color, color: part.ink }}
              aria-label={`${part.label}: ${usd(values[i])}, ${pct(share, 0)}`}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              {/* A share is printed only where the block is wide enough to hold it. */}
              {share >= 0.07 ? pct(share, 0) : ""}
            </button>
          );
        })}
        {hover !== null && (
          <div
            className="tip"
            style={{ left: `${Math.min(92, Math.max(8, (starts[hover] + values[hover] / total / 2) * 100))}%` }}
          >
            <strong>{usd(values[hover])}</strong>
            {PARTS[hover].label}, {pct(values[hover] / total)} of gross
          </div>
        )}
      </div>
    </div>
  );
}

interface Line {
  label: string;
  color?: string;
  value: (b: Breakdown) => number;
  total?: boolean;
}

const LINES: Line[] = [
  { label: "Gross pay", value: (b) => b.gross.total, total: true },
  { label: "Federal income tax", color: "var(--series-1)", value: (b) => b.federal.tax },
  { label: "State income tax", color: "var(--series-2)", value: (b) => b.state.tax },
  { label: "Social Security", color: "var(--series-3)", value: (b) => b.fica.socialSecurity },
  { label: "Medicare", color: "var(--series-3)", value: (b) => b.fica.medicare + b.fica.additionalMedicare },
  { label: "Traditional 401k", color: "var(--series-4)", value: (b) => b.contributions.traditional401k },
  { label: "Roth 401k", color: "var(--series-4)", value: (b) => b.contributions.roth401k },
  { label: "Traditional IRA", color: "var(--series-4)", value: (b) => b.contributions.traditionalIra },
  { label: "Roth IRA", color: "var(--series-4)", value: (b) => b.contributions.rothIra },
  { label: "HSA", color: "var(--series-4)", value: (b) => b.contributions.hsa },
  { label: "Health insurance premiums", color: "var(--series-4)", value: (b) => b.contributions.healthPremiums },
  { label: "Health FSA", color: "var(--series-4)", value: (b) => b.contributions.fsa },
  { label: "Commuter benefits", color: "var(--series-4)", value: (b) => b.contributions.commuter },
  { label: "Take-home", color: "var(--series-neutral)", value: (b) => b.totals.takeHome, total: true },
];

function BracketTable({ title, slices, note }: { title: string; slices: BracketSlice[]; note?: string }) {
  return (
    <div>
      <h3>{title}</h3>
      {slices.length === 0 ? (
        <p className="secondary">{note ?? "No income tax on wages."}</p>
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th className="num">Rate</th>
                <th>Taxable income in bracket</th>
                <th className="num">Your income here</th>
                <th className="num">Tax</th>
              </tr>
            </thead>
            <tbody>
              {slices.map((s) => (
                <tr key={s.from} className={s.income === 0 ? "zero" : undefined}>
                  <td className="num">{rate(s.rate)}</td>
                  <td className="key">
                    {s.to === null ? `Over ${usd(s.from)}` : `${usd(s.from)} to ${usd(s.to)}`}
                  </td>
                  <td className="num">{usd(s.income)}</td>
                  <td className="num">{usd(s.tax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {note && slices.length > 0 && (
        <p className="hint" style={{ marginTop: 8 }}>
          {note}
        </p>
      )}
    </div>
  );
}

export function TaxBreakdown({ base, scenario, hasChange }: Props) {
  const gross = base.gross.total;
  const stateExtras = [
    base.state.federalTaxDeduction > 0 &&
      `${usd(base.state.federalTaxDeduction)} of federal income tax deducted`,
    base.state.medicalDeduction > 0 &&
      `${usd(base.state.medicalDeduction)} of health premiums deducted as medical expenses`,
    base.state.payrollTaxDeduction > 0 &&
      `${usd(base.state.payrollTaxDeduction)} of Social Security and Medicare tax deducted`,
    base.state.surtax > 0 && `${usd(base.state.surtax)} surtax`,
    base.state.adjustments > 0 && `${usd(base.state.adjustments)} added by rules for higher incomes`,
    base.state.credits - base.state.childCredits - base.state.earnedIncomeCredit > 0.005 &&
      `${usd(base.state.credits - base.state.childCredits - base.state.earnedIncomeCredit)} of credits`,
    base.state.earnedIncomeCredit > 0 && `${usd(base.state.earnedIncomeCredit)} earned income credit`,
    base.state.childCredits > 0 && `${usd(base.state.childCredits)} of credits for children`,
  ].filter(Boolean);
  const federalExtras = [
    base.federal.itemizes
      ? `${usd(base.federal.deduction)} of state income tax itemized, which beats the ${usd(base.federal.standardDeduction)} standard deduction`
      : `${usd(base.federal.standardDeduction)} standard deduction`,
    base.federal.overtimeDeduction > 0 && `${usd(base.federal.overtimeDeduction)} overtime deduction`,
    base.federal.iraDeduction > 0 && `${usd(base.federal.iraDeduction)} IRA deduction`,
    base.federal.dependentCredits > 0 && `${usd(base.federal.dependentCredits)} of credits for dependents`,
    base.federal.earnedIncomeCredit > 0 && `${usd(base.federal.earnedIncomeCredit)} earned income credit`,
  ].filter(Boolean);

  return (
    <section className="card">
      <h2>Where each dollar goes</h2>
      <p className="sub">Every dollar of gross pay, split into tax, what you set aside, and what you keep.</p>

      <div className="bars">
        <DollarBar label="Now" breakdown={base} />
        {hasChange && <DollarBar label="With change" breakdown={scenario} />}
      </div>
      <div className="legend">
        {PARTS.map((p) => (
          <span key={p.key}>
            <i className="swatch" style={{ background: p.color }} />
            {p.label}
          </span>
        ))}
      </div>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">A year</th>
              <th className="num">Share of gross</th>
              {hasChange && (
                <>
                  <th className="num">With change</th>
                  <th className="num">Difference</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {LINES.filter((l) => l.total || l.value(base) !== 0 || l.value(scenario) !== 0).map((line) => {
              const now = line.value(base);
              const later = line.value(scenario);
              return (
                <tr key={line.label} className={line.total ? "total" : undefined}>
                  <th scope="row">
                    {line.color && <i className="swatch" style={{ background: line.color }} />}
                    {line.label}
                  </th>
                  <td className="num">{usd(now)}</td>
                  <td className="num">{gross > 0 ? pct(now / gross) : "0.0%"}</td>
                  {hasChange && (
                    <>
                      <td className="num">{usd(later)}</td>
                      <td className="num">{signedUsd(later - now)}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="split" style={{ marginTop: 20 }}>
        <BracketTable
          title={`Federal brackets (${pct(gross > 0 ? base.federal.tax / gross : 0)} of gross, top bracket ${rate(base.federal.marginalRate)})`}
          slices={base.federal.slices}
          note={`Taxable income ${usd(base.federal.taxableIncome)} after ${federalExtras.join(", ")}.`}
        />
        <BracketTable
          title={
            base.state.hasIncomeTax
              ? `${base.state.name} brackets (${pct(gross > 0 ? base.state.tax / gross : 0)} of gross, top bracket ${rate(base.state.marginalRate)})`
              : `${base.state.name}`
          }
          slices={base.state.slices}
          note={
            base.state.hasIncomeTax
              ? `Taxable income ${usd(base.state.taxableIncome)}.${stateExtras.length ? ` Also ${stateExtras.join(", ")}.` : ""}`
              : `${base.state.name} does not tax wages.`
          }
        />
      </div>
    </section>
  );
}
