"use client";

import { childAges } from "@engine";
import type { Bundle, FilingStatus, MatchTier, PayChange, Profile } from "@engine";
import { AmountField, Checkbox, NumberField, Segmented, SelectField } from "./fields";

interface Props {
  profile: Profile;
  change: PayChange;
  bundle: Bundle;
  onProfile: (profile: Profile) => void;
  onChange: (change: PayChange) => void;
}

const FILING: { value: FilingStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "mfj", label: "Married" },
  { value: "hoh", label: "Head of house" },
];

export function InputsPanel({ profile, change, bundle, onProfile, onChange }: Props) {
  const { income, contributions: c, employer } = profile;
  const set = (patch: Partial<Profile>) => onProfile({ ...profile, ...patch });
  const setContribution = (patch: Partial<Profile["contributions"]>) =>
    set({ contributions: { ...c, ...patch } });
  const setEmployer = (patch: Partial<Profile["employer"]>) =>
    set({ employer: { ...employer, ...patch } });

  const states = Object.values(bundle.states)
    .map((s) => ({ value: s.jurisdiction, label: s.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const switchKind = (kind: "salary" | "hourly") => {
    if (kind === income.kind) return;
    if (kind === "hourly") {
      const annual = income.kind === "salary" ? income.annual : 0;
      set({
        income: {
          kind: "hourly",
          rate: Math.round((annual / 2080) * 100) / 100,
          hoursPerWeek: 40,
          weeksPerYear: 52,
          overtimeHoursPerWeek: 0,
        },
      });
    } else if (income.kind === "hourly") {
      const annual = income.rate * income.hoursPerWeek * income.weeksPerYear;
      set({ income: { kind: "salary", annual: Math.round(annual) } });
    }
  };

  // The form offers two match tiers, which covers nearly every employer formula.
  const tier = (i: number): MatchTier => employer.match[i] ?? { rate: 0, upToPercent: 0 };
  const setTier = (i: number, patch: Partial<MatchTier>) => {
    const tiers = [tier(0), tier(1)];
    tiers[i] = { ...tiers[i], ...patch };
    // Empty tiers stay in place so a half-filled row is not wiped mid-edit. They match nothing.
    setEmployer({ match: tiers });
  };

  return (
    <aside className="inputs" aria-label="Your details">
      <section className="card">
        <h2>Income</h2>
        <div className="fields">
          <Segmented
            label="Paid by"
            value={income.kind}
            options={[
              { value: "salary", label: "Salary" },
              { value: "hourly", label: "Hourly" },
            ]}
            onChange={switchKind}
          />
          {income.kind === "salary" ? (
            <NumberField
              label="Annual salary"
              before="$"
              value={income.annual}
              onChange={(annual) => set({ income: { ...income, annual } })}
            />
          ) : (
            <>
              <NumberField
                label="Hourly rate"
                before="$"
                after="an hour"
                value={income.rate}
                onChange={(rate) => set({ income: { ...income, rate } })}
              />
              <div className="row2">
                <NumberField
                  label="Hours a week"
                  value={income.hoursPerWeek}
                  onChange={(hoursPerWeek) =>
                    set({ income: { ...income, hoursPerWeek: Math.min(168, Math.max(1, hoursPerWeek)) } })
                  }
                />
                <NumberField
                  label="Weeks a year"
                  value={income.weeksPerYear}
                  onChange={(weeksPerYear) =>
                    set({ income: { ...income, weeksPerYear: Math.min(52, Math.max(1, weeksPerYear)) } })
                  }
                />
              </div>
              <NumberField
                label="Overtime hours a week"
                value={income.overtimeHoursPerWeek ?? 0}
                onChange={(overtimeHoursPerWeek) =>
                  set({ income: { ...income, overtimeHoursPerWeek: Math.min(128, overtimeHoursPerWeek) } })
                }
                hint="Paid at time and a half."
              />
            </>
          )}
          <NumberField
            label="Bonus and other taxable pay"
            before="$"
            after="a year"
            value={profile.bonus}
            onChange={(bonus) => set({ bonus })}
          />
        </div>
      </section>

      <section className="card">
        <h2>Compare with</h2>
        <div className="fields">
          <NumberField
            label="A raise or cut of"
            signed
            before={change.unit === "dollars" ? "$" : undefined}
            after={change.unit === "percent" ? "%" : change.per === "hour" ? "an hour" : "a year"}
            value={change.amount}
            onChange={(amount) => onChange({ ...change, amount })}
            hint="Use a negative number for a cut."
          />
          <div className="row2">
            <Segmented
              label="Measured in"
              value={change.unit}
              options={[
                { value: "percent", label: "%" },
                { value: "dollars", label: "$" },
              ]}
              onChange={(unit) => onChange({ ...change, unit })}
            />
            {change.unit === "dollars" && (
              <Segmented
                label="Per"
                value={change.per}
                options={[
                  { value: "year", label: "Year" },
                  { value: "hour", label: "Hour" },
                ]}
                onChange={(per) => onChange({ ...change, per })}
              />
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>You</h2>
        <div className="fields">
          <SelectField
            label="State"
            value={profile.state}
            options={states}
            onChange={(state) => set({ state })}
          />
          <Segmented
            label="Filing status"
            value={profile.filingStatus}
            options={FILING}
            onChange={(filingStatus) => set({ filingStatus })}
          />
          <div className="row2">
            <NumberField
              label="Age"
              value={profile.age}
              onChange={(age) => set({ age: Math.min(110, Math.max(14, Math.round(age))) })}
            />
            <NumberField
              label="Children under 17"
              value={profile.dependents.children}
              onChange={(n) => {
                const children = Math.min(20, Math.round(n));
                set({
                  dependents: {
                    ...profile.dependents,
                    children,
                    childAges: childAges({ ...profile, dependents: { ...profile.dependents, children } }),
                  },
                });
              }}
            />
          </div>
          {profile.dependents.children > 0 && (
            <div className="field">
              <span className="label">Each child's age at the end of the year</span>
              <div className="ages">
                {childAges(profile).map((age, i) => (
                  <NumberField
                    key={i}
                    label={`Child ${i + 1}`}
                    value={age}
                    onChange={(n) => {
                      const ages = childAges(profile);
                      ages[i] = Math.min(16, Math.max(0, Math.round(n)));
                      set({ dependents: { ...profile.dependents, childAges: ages } });
                    }}
                  />
                ))}
              </div>
              <span className="hint">Some states give more for younger children.</span>
            </div>
          )}
          <NumberField
            label="Other dependents"
            value={profile.dependents.other}
            onChange={(n) =>
              set({ dependents: { ...profile.dependents, other: Math.min(20, Math.round(n)) } })
            }
          />
        </div>
      </section>

      <section className="card">
        <h2>Retirement</h2>
        <div className="fields">
          <AmountField
            label="Traditional 401k"
            value={c.traditional401k}
            onChange={(traditional401k) => setContribution({ traditional401k })}
          />
          <AmountField
            label="Roth 401k"
            value={c.roth401k}
            onChange={(roth401k) => setContribution({ roth401k })}
          />
          <AmountField
            label="Traditional IRA"
            value={c.traditionalIra}
            onChange={(traditionalIra) => setContribution({ traditionalIra })}
          />
          <AmountField
            label="Roth IRA"
            value={c.rothIra}
            onChange={(rothIra) => setContribution({ rothIra })}
          />
          <Checkbox
            label="I have a retirement plan at work"
            checked={profile.coveredByWorkplacePlan}
            onChange={(coveredByWorkplacePlan) => set({ coveredByWorkplacePlan })}
          />
        </div>
      </section>

      <section className="card">
        <h2>Health and benefits</h2>
        <div className="fields">
          <AmountField
            label="Health insurance premiums"
            value={c.healthPremiums}
            onChange={(healthPremiums) => setContribution({ healthPremiums })}
          />
          <SelectField
            label="HSA-eligible health plan"
            value={c.hsaCoverage}
            options={[
              { value: "none", label: "No" },
              { value: "self", label: "Yes, covering just me" },
              { value: "family", label: "Yes, covering my family" },
            ]}
            onChange={(hsaCoverage) => setContribution({ hsaCoverage })}
          />
          {c.hsaCoverage !== "none" && (
            <>
              <AmountField
                label="HSA contribution"
                value={c.hsa}
                onChange={(hsa) => setContribution({ hsa })}
              />
              <Checkbox
                label="HSA money comes out of my paycheck"
                checked={c.hsaViaPayroll}
                onChange={(hsaViaPayroll) => setContribution({ hsaViaPayroll })}
              />
            </>
          )}
          <AmountField label="Health FSA" value={c.fsa} onChange={(fsa) => setContribution({ fsa })} />
          <AmountField
            label="Commuter benefits"
            value={c.commuter}
            onChange={(commuter) => setContribution({ commuter })}
          />
        </div>
      </section>

      <section className="card">
        <h2>From your employer</h2>
        <div className="fields">
          <div className="row2">
            <NumberField
              label="401k match"
              after="%"
              value={Math.round(tier(0).rate * 100)}
              onChange={(n) => setTier(0, { rate: n / 100 })}
            />
            <NumberField
              label="Of the first"
              after="% of pay"
              value={tier(0).upToPercent}
              onChange={(n) => setTier(0, { upToPercent: Math.min(100, n) })}
            />
          </div>
          <div className="row2">
            <NumberField
              label="Then match"
              after="%"
              value={Math.round(tier(1).rate * 100)}
              onChange={(n) => setTier(1, { rate: n / 100 })}
            />
            <NumberField
              label="Up to"
              after="% of pay"
              value={tier(1).upToPercent}
              onChange={(n) => setTier(1, { upToPercent: Math.min(100, n) })}
            />
          </div>
          {c.hsaCoverage !== "none" && (
            <NumberField
              label="Employer HSA contribution"
              before="$"
              after="a year"
              value={employer.hsa}
              onChange={(hsa) => setEmployer({ hsa })}
            />
          )}
          <NumberField
            label="Other employer-paid compensation"
            before="$"
            after="a year"
            value={employer.other}
            onChange={(other) => setEmployer({ other })}
            hint="Counts toward total compensation only."
          />
        </div>
      </section>
    </aside>
  );
}
