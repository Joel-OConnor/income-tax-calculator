"use client";

import { useMemo, useState } from "react";
import { compareStates } from "@engine";
import type { Bundle, Profile, StateComparison } from "@engine";
import { pct, signedUsd, usd } from "@/lib/format";

interface Props {
  profile: Profile;
  bundle: Bundle;
  pinned: string[];
  onPinned: (codes: string[]) => void;
}

type SortKey = "name" | "stateTax" | "totalTax" | "takeHome";
const MAX_PINS = 3;

export function StateCompare({ profile, bundle, pinned, onPinned }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: "takeHome",
    descending: true,
  });
  const rows = useMemo(() => compareStates(profile, bundle), [profile, bundle]);
  const byCode = useMemo(() => new Map(rows.map((r) => [r.code, r])), [rows]);
  const home = byCode.get(profile.state);
  const highestStateTax = Math.max(1, ...rows.map((r) => r.stateTax));
  const gross = home ? home.takeHome + home.totalTax : 0;

  const sorted = useMemo(() => {
    const direction = sort.descending ? -1 : 1;
    return [...rows].sort((a, b) =>
      sort.key === "name"
        ? direction * a.name.localeCompare(b.name)
        : direction * (a[sort.key] - b[sort.key]) || a.name.localeCompare(b.name),
    );
  }, [rows, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, descending: !s.descending } : { key, descending: key !== "name" }));
  const togglePin = (code: string) =>
    onPinned(pinned.includes(code) ? pinned.filter((c) => c !== code) : [...pinned, code].slice(-MAX_PINS));

  const header = (key: SortKey, label: string, numeric = true) => (
    <th
      className={`sortable ${numeric ? "num" : ""}`}
      aria-sort={sort.key === key ? (sort.descending ? "descending" : "ascending") : "none"}
    >
      <button type="button" onClick={() => toggleSort(key)}>
        {label}
        {sort.key === key ? (sort.descending ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  const card = (row: StateComparison, isHome: boolean) => (
    <div key={row.code} className={`pin ${isHome ? "home" : ""}`}>
      <h3>
        <span>{row.name}</span>
        {isHome ? (
          <span className="muted">Your state</span>
        ) : (
          <button type="button" className="linkbtn" onClick={() => togglePin(row.code)}>
            Remove
          </button>
        )}
      </h3>
      <dl>
        <dt>State income tax</dt>
        <dd>{usd(row.stateTax)}</dd>
        <dt>Total tax</dt>
        <dd>{usd(row.totalTax)}</dd>
        <dt>Take-home a year</dt>
        <dd>{usd(row.takeHome)}</dd>
        <dt>Take-home a month</dt>
        <dd>{usd(row.takeHome / 12)}</dd>
        {!isHome && (
          <>
            <dt>Compared with {home?.code}</dt>
            <dd className={row.takeHomeDifference > 0 ? "up" : row.takeHomeDifference < 0 ? "down" : ""}>
              {signedUsd(row.takeHomeDifference)}
            </dd>
          </>
        )}
        <dt>Tax as share of gross</dt>
        <dd>{gross > 0 ? pct(row.totalTax / gross) : "0.0%"}</dd>
      </dl>
      {(row.hasLocalIncomeTaxes || row.hasStatePayrollTax) && (
        <p className="hint">
          Not included:{" "}
          {[row.hasLocalIncomeTaxes && "local income taxes", row.hasStatePayrollTax && "state payroll taxes"]
            .filter(Boolean)
            .join(" and ")}
          .
        </p>
      )}
    </div>
  );

  return (
    <section className="card">
      <h2>The same pay in every state</h2>
      <p className="sub">
        Your exact inputs, run through each state's income tax. This covers income tax only. Sales
        tax, property tax, local taxes and cost of living are not part of it, so a state with no
        income tax is not automatically cheaper to live in.
      </p>

      <div className="pins">
        {home && card(home, true)}
        {pinned.filter((c) => c !== profile.state && byCode.has(c)).map((c) => card(byCode.get(c)!, false))}
      </div>
      <p className="hint" style={{ marginBottom: 10 }}>
        Star up to {MAX_PINS} states in the table to compare them side by side.
      </p>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th aria-label="Pin" />
              {header("name", "State", false)}
              {header("stateTax", "State income tax")}
              {header("totalTax", "Total tax")}
              {header("takeHome", "Take-home")}
              <th className="num">Compared with {home?.code}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const isHome = row.code === profile.state;
              const isPinned = pinned.includes(row.code);
              return (
                <tr key={row.code} className={isHome ? "homerow" : undefined}>
                  <td>
                    {!isHome && (
                      <button
                        type="button"
                        className="star"
                        aria-pressed={isPinned}
                        aria-label={`${isPinned ? "Unpin" : "Pin"} ${row.name}`}
                        onClick={() => togglePin(row.code)}
                      >
                        {isPinned ? "★" : "☆"}
                      </button>
                    )}
                  </td>
                  <td className="key">
                    {row.name}
                    {row.hasLocalIncomeTaxes && <span className="tag">local taxes</span>}
                  </td>
                  <td className="num">
                    {row.stateTax > 0 && (
                      <i
                        className="minibar"
                        style={{ width: Math.max(2, (row.stateTax / highestStateTax) * 64), marginRight: 8 }}
                      />
                    )}
                    {usd(row.stateTax)}
                  </td>
                  <td className="num">{usd(row.totalTax)}</td>
                  <td className="num">{usd(row.takeHome)}</td>
                  <td
                    className={`num ${row.takeHomeDifference > 0 ? "up" : row.takeHomeDifference < 0 ? "down" : ""}`}
                  >
                    {isHome ? "" : signedUsd(row.takeHomeDifference)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
