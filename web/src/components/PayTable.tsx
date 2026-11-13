"use client";

import { perPeriod } from "@engine";
import type { Breakdown, Periods, Profile } from "@engine";
import { signedUsd, usd, usd2 } from "@/lib/format";

interface Props {
  base: Breakdown;
  scenario: Breakdown;
  profile: Profile;
  scenarioProfile: Profile;
  hasChange: boolean;
}

const ROWS: { key: keyof Periods; label: string }[] = [
  { key: "hourly", label: "Hourly" },
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "biweekly", label: "Every two weeks" },
  { key: "semimonthly", label: "Twice a month" },
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
  { key: "yearly", label: "Yearly" },
];

export function PayTable({ base, scenario, profile, scenarioProfile, hasChange }: Props) {
  const grossBase = perPeriod(base.gross.total, profile);
  const netBase = perPeriod(base.totals.takeHome, profile);
  const grossNew = perPeriod(scenario.gross.total, scenarioProfile);
  const netNew = perPeriod(scenario.totals.takeHome, scenarioProfile);
  // Small amounts need cents to be meaningful.
  const money = (key: keyof Periods, n: number) => (key === "hourly" || key === "daily" ? usd2(n) : usd(n));

  return (
    <section className="card">
      <h2>Pay by period</h2>
      <p className="sub">
        Gross is before anything comes out. Take-home is after tax and after your retirement,
        health and benefit contributions.
      </p>
      <div className="tablewrap">
        <table>
          <thead>
            {hasChange && (
              <tr>
                <th />
                <th className="group" colSpan={2}>
                  Now
                </th>
                <th className="group" colSpan={2}>
                  With change
                </th>
                <th />
              </tr>
            )}
            <tr>
              <th>Period</th>
              <th className="num">Gross</th>
              <th className="num">Take-home</th>
              {hasChange && (
                <>
                  <th className="num">Gross</th>
                  <th className="num">Take-home</th>
                  <th className="num">Take-home change</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(({ key, label }) => {
              const change = netNew[key] - netBase[key];
              return (
                <tr key={key} className={key === "yearly" ? "total" : undefined}>
                  <th scope="row">{label}</th>
                  <td className="num">{money(key, grossBase[key])}</td>
                  <td className="num">{money(key, netBase[key])}</td>
                  {hasChange && (
                    <>
                      <td className="num">{money(key, grossNew[key])}</td>
                      <td className="num">{money(key, netNew[key])}</td>
                      <td className={`num ${change > 0 ? "up" : change < 0 ? "down" : ""}`}>
                        {key === "hourly" || key === "daily"
                          ? (change > 0 ? "+" : "") + usd2(change)
                          : signedUsd(change)}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        Tax is the full-year amount spread evenly. Real paychecks can differ, especially ones
        with a bonus in them.
      </p>
    </section>
  );
}
