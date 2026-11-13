"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { calculate, withBasePay } from "@engine";
import type { Breakdown, Bundle, Profile } from "@engine";
import { compactUsd, pct, usd } from "@/lib/format";

interface Props {
  profile: Profile;
  bundle: Bundle;
  base: Breakdown;
  scenario: Breakdown;
  hasChange: boolean;
}

interface Row {
  gross: number;
  total: number;
  federal: number;
  state: number;
  payroll: number;
  /** Share of the dollars since the previous sample that went to tax. */
  marginal: number;
}

interface Marker {
  gross: number;
  label: string;
  detail: string;
}

const SAMPLES = 200;

const SERIES = [
  { key: "total", label: "Total tax", color: "var(--ink)" },
  { key: "federal", label: "Federal income tax", color: "var(--series-1)" },
  { key: "state", label: "State income tax", color: "var(--series-2)" },
  { key: "payroll", label: "Social Security and Medicare", color: "var(--series-3)" },
] as const;

/** The lowest base pay in [low, high] at which `reached` turns true, to the nearest few dollars. */
function crossing(low: number, high: number, reached: (basePay: number) => boolean): number {
  for (let i = 0; i < 12; i++) {
    const mid = (low + high) / 2;
    if (reached(mid)) high = mid;
    else low = mid;
  }
  return high;
}

function buildCurve(profile: Profile, bundle: Bundle, maxGross: number) {
  const at = (basePay: number) => calculate(withBasePay(profile, basePay), bundle);
  const maxBase = Math.max(0, maxGross - profile.bonus);
  const samples = Array.from({ length: SAMPLES + 1 }, (_, i) => {
    const basePay = (maxBase * i) / SAMPLES;
    return { basePay, b: at(basePay) };
  });

  const rows: Row[] = samples.map(({ b }, i) => {
    const previous = samples[Math.max(0, i - 1)].b;
    const step = b.gross.total - previous.gross.total;
    return {
      gross: b.gross.total,
      total: b.totals.tax,
      federal: b.federal.tax,
      state: b.state.tax,
      payroll: b.fica.total,
      marginal: step > 0 ? (b.totals.tax - previous.totals.tax) / step : 0,
    };
  });
  if (rows.length > 1) rows[0].marginal = rows[1].marginal;

  // Points where the rules change: a new federal bracket, the end of Social
  // Security tax, and the start of the extra Medicare tax.
  const markers: Marker[] = [];
  const wageBase = bundle.federal.fica.socialSecurity.wageBase;
  for (let i = 1; i < samples.length; i++) {
    const before = samples[i - 1];
    const after = samples[i];
    const find = (reached: (b: Breakdown) => boolean) =>
      at(crossing(before.basePay, after.basePay, (pay) => reached(at(pay)))).gross.total;

    const rate = after.b.federal.marginalRate;
    if (rate !== before.b.federal.marginalRate && after.b.federal.taxableIncome > 0 && before.b.federal.taxableIncome > 0) {
      markers.push({
        gross: find((b) => b.federal.marginalRate >= rate),
        label: pct(rate, 0),
        detail: `Federal ${pct(rate, 0)} bracket starts`,
      });
    }
    if (before.b.fica.wages < wageBase && after.b.fica.wages >= wageBase) {
      markers.push({
        gross: find((b) => b.fica.wages >= wageBase),
        label: "SS ends",
        detail: "Social Security tax stops",
      });
    }
    if (before.b.fica.additionalMedicare === 0 && after.b.fica.additionalMedicare > 0) {
      markers.push({
        gross: find((b) => b.fica.additionalMedicare > 0),
        label: "+0.9%",
        detail: "Extra 0.9% Medicare tax starts",
      });
    }
  }
  markers.sort((a, b) => a.gross - b.gross);
  return { rows, markers };
}

/** Width in pixels of the element the returned ref is attached to. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

// Space taken by the y-axis and chart margins, and the room one marker label needs.
const PLOT_INSET = 84;
const LABEL_GAP = 46;

function CurveTip({ row }: { row?: Row }) {
  if (!row) return null;
  return (
    <div className="charttip">
      <div className="head">At {usd(row.gross)} gross</div>
      {SERIES.map((s) => (
        <div className="line" key={s.key}>
          <span>
            <i className="linekey" style={{ background: s.color }} />
            {s.label}
          </span>
          <strong>{usd(row[s.key])}</strong>
        </div>
      ))}
    </div>
  );
}

function RateTip({ row }: { row?: Row }) {
  if (!row) return null;
  return (
    <div className="charttip">
      <div className="head">Around {usd(row.gross)} gross</div>
      <div className="line">
        <span>Tax on the next dollar</span>
        <strong>{pct(row.marginal)}</strong>
      </div>
    </div>
  );
}

export function TaxCurve({ profile, bundle, base, scenario, hasChange }: Props) {
  const maxGross = useMemo(() => {
    const top = Math.max(base.gross.total, hasChange ? scenario.gross.total : 0);
    return Math.max(250_000, Math.ceil((top * 1.6) / 50_000) * 50_000);
  }, [base.gross.total, scenario.gross.total, hasChange]);

  const { rows, markers } = useMemo(
    () => buildCurve(profile, bundle, maxGross),
    [profile, bundle, maxGross],
  );

  const axis = {
    dataKey: "gross",
    type: "number" as const,
    domain: [0, maxGross] as [number, number],
    tickFormatter: compactUsd,
    tickLine: false,
    axisLine: { stroke: "var(--axis)" },
    tickCount: 6,
  };
  // On a narrow chart neighboring labels would overlap, so a label is dropped
  // when it sits too close to the one before it. The caption still lists them all.
  const [chartRef, chartWidth] = useWidth();
  const roomFor = useMemo(() => {
    const plotWidth = Math.max(0, chartWidth - PLOT_INSET);
    const shown = new Set<Marker>();
    let previous = -Infinity;
    for (const m of markers) {
      const x = (m.gross / maxGross) * plotWidth;
      if (x - previous >= LABEL_GAP) {
        shown.add(m);
        previous = x;
      }
    }
    return shown;
  }, [markers, chartWidth, maxGross]);

  const markerLines = (labeled: boolean) =>
    markers.map((m) => (
      <ReferenceLine
        key={`${m.label}-${m.gross}`}
        x={m.gross}
        stroke="var(--axis)"
        label={
          labeled && roomFor.has(m)
            ? { value: m.label, position: "top", fill: "var(--ink-2)", fontSize: 11 }
            : undefined
        }
      />
    ));
  const tableRows = rows.filter((_, i) => i % (SAMPLES / 10) === 0);
  const scenarioIsHigher = scenario.gross.total >= base.gross.total;

  return (
    <section className="card">
      <h2>How tax grows with income</h2>
      <p className="sub">
        Tax owed at every income from $0 to {compactUsd(maxGross)}, with everything else about
        you held the same. Vertical lines mark where the rules change.
      </p>

      <div className="legend">
        {SERIES.map((s) => (
          <span key={s.key}>
            <i className="linekey" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="chart" ref={chartRef} role="img" aria-label="Line chart of tax owed by gross income">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={rows} margin={{ top: 22, right: 28, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis {...axis} />
            <YAxis tickFormatter={compactUsd} tickLine={false} axisLine={false} width={52} />
            <Tooltip
              cursor={{ stroke: "var(--muted)" }}
              content={(p) => <CurveTip row={p.active ? (p.payload?.[0]?.payload as Row) : undefined} />}
            />
            {markerLines(true)}
            {[...SERIES].reverse().map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
            {hasChange && (
              <ReferenceDot
                x={scenario.gross.total}
                y={scenario.totals.tax}
                r={5}
                fill="var(--surface)"
                stroke="var(--ink)"
                strokeWidth={2}
                label={{
                  value: "With change",
                  position: scenarioIsHigher ? "right" : "left",
                  fill: "var(--ink)",
                  fontSize: 11,
                }}
              />
            )}
            <ReferenceDot
              x={base.gross.total}
              y={base.totals.tax}
              r={5}
              fill="var(--ink)"
              stroke="var(--surface)"
              strokeWidth={2}
              label={{
                value: "Now",
                position: hasChange && scenarioIsHigher ? "left" : "right",
                fill: "var(--ink)",
                fontSize: 11,
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <h3 className="charttitle">Tax on the next dollar earned</h3>
      <div className="chart" role="img" aria-label="Step chart of the marginal tax rate by gross income">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={rows} margin={{ top: 8, right: 28, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis {...axis} />
            <YAxis
              tickFormatter={(v: number) => pct(v, 0)}
              tickLine={false}
              axisLine={false}
              width={52}
            />
            <Tooltip
              cursor={{ stroke: "var(--muted)" }}
              content={(p) => <RateTip row={p.active ? (p.payload?.[0]?.payload as Row) : undefined} />}
            />
            {markerLines(false)}
            <ReferenceLine x={base.gross.total} stroke="var(--ink)" />
            <Line
              type="stepBefore"
              dataKey="marginal"
              stroke="var(--series-1)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {markers.length > 0 && (
        <p className="hint" style={{ marginTop: 8 }}>
          {markers.map((m) => `${m.detail} at ${usd(m.gross)}`).join(". ")}. The dark line in the
          lower chart is your income now. Jumps that are not marked come from state brackets,
          deductions or credits changing with income.
        </p>
      )}

      <details style={{ marginTop: 12 }}>
        <summary className="secondary">Show as a table</summary>
        <div className="tablewrap" style={{ marginTop: 8 }}>
          <table>
            <thead>
              <tr>
                <th className="num">Gross pay</th>
                <th className="num">Federal</th>
                <th className="num">State</th>
                <th className="num">Social Security and Medicare</th>
                <th className="num">Total tax</th>
                <th className="num">Tax on the next dollar</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr key={r.gross}>
                  <td className="num">{usd(r.gross)}</td>
                  <td className="num">{usd(r.federal)}</td>
                  <td className="num">{usd(r.state)}</td>
                  <td className="num">{usd(r.payroll)}</td>
                  <td className="num">{usd(r.total)}</td>
                  <td className="num">{pct(r.marginal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
