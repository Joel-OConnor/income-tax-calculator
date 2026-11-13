"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { applyChange, calculate, marginalRate } from "@engine";
import type { Bundle } from "@engine";
import type { SavedState } from "@/lib/profile";
import type { SyncStatus as Status } from "@/server/sync";
import { InputsPanel } from "./InputsPanel";
import { PayTable } from "./PayTable";
import { StateCompare } from "./StateCompare";
import { StateNotes } from "./StateNotes";
import { Summary } from "./Summary";
import { SyncStatus } from "./SyncStatus";
import { TaxBreakdown } from "./TaxBreakdown";
import { TaxCurve } from "./TaxCurve";

interface Props {
  initialBundle: Bundle;
  initialStatus: Status;
  initialState: SavedState;
}

export function Calculator({ initialBundle, initialStatus, initialState }: Props) {
  const [bundle, setBundle] = useState(initialBundle);
  const [status, setStatus] = useState(initialStatus);
  const [state, setState] = useState(initialState);
  const { profile, change, pinnedStates } = state;

  // Everything is computed in the browser from the synced data, so results
  // update as the user types.
  const base = useMemo(() => calculate(profile, bundle), [profile, bundle]);
  const scenarioProfile = useMemo(() => applyChange(profile, change), [profile, change]);
  const scenario = useMemo(() => calculate(scenarioProfile, bundle), [scenarioProfile, bundle]);
  const baseMarginal = useMemo(() => marginalRate(profile, bundle), [profile, bundle]);
  const hasChange = change.amount !== 0;

  // Remember the inputs between visits, saving shortly after the last edit.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void fetch("/api/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(state),
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <>
      <header className="topbar">
        <h1>Income Tax Calculator</h1>
        <SyncStatus
          status={status}
          taxYear={bundle.taxYear}
          onSynced={(next, nextBundle) => {
            setStatus(next);
            if (nextBundle) setBundle(nextBundle);
          }}
        />
      </header>

      <div className="layout">
        <InputsPanel
          profile={profile}
          change={change}
          bundle={bundle}
          onProfile={(next) => setState((s) => ({ ...s, profile: next }))}
          onChange={(next) => setState((s) => ({ ...s, change: next }))}
        />

        <main className="results">
          <Summary base={base} scenario={scenario} baseMarginal={baseMarginal} hasChange={hasChange} />
          <PayTable
            base={base}
            scenario={scenario}
            profile={profile}
            scenarioProfile={scenarioProfile}
            hasChange={hasChange}
          />
          <TaxBreakdown base={base} scenario={scenario} hasChange={hasChange} />
          <TaxCurve
            profile={profile}
            bundle={bundle}
            base={base}
            scenario={scenario}
            hasChange={hasChange}
          />
          <StateCompare
            profile={profile}
            bundle={bundle}
            pinned={pinnedStates}
            onPinned={(codes) => setState((s) => ({ ...s, pinnedStates: codes }))}
          />
          <StateNotes state={bundle.states[profile.state]} taxYear={bundle.taxYear} />
          <p className="foot">
            An estimate for {bundle.taxYear}, not tax advice. It covers wage income taken with the
            standard deduction, and leaves out local taxes, itemized deductions, investment income
            and self-employment.
          </p>
        </main>
      </div>
    </>
  );
}
