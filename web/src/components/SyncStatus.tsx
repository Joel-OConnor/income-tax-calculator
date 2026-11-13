"use client";

import { useEffect, useState } from "react";
import type { Bundle } from "@engine";
import { timeAgo } from "@/lib/format";
import type { SyncStatus as Status } from "@/server/sync";

interface Props {
  status: Status;
  taxYear?: number;
  onSynced: (status: Status, bundle: Bundle | null) => void;
}

/** Shows when tax data was last pulled and lets the user pull it again. */
export function SyncStatus({ status, taxYear, onSynced }: Props) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Relative times depend on the viewer's clock, so they render after mount.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const sync = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      if (!response.ok) throw new Error(`Sync failed (HTTP ${response.status})`);
      const result = (await response.json()) as { status: Status; bundle: Bundle | null };
      onSynced(result.status, result.bundle);
      setNow(Date.now());
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  };

  const year = status.years.find((y) => y.taxYear === taxYear) ?? status.years[0];
  const error = failure ?? (status.lastAttempt?.status === "error" ? status.lastAttempt.error : null);
  const synced = status.lastSuccessAt;

  return (
    <div className="sync">
      <span className="state">
        <i className={`dot ${error ? "error" : ""}`} aria-hidden />
        {year ? `${year.taxYear} tax data` : "No tax data"}
        {year && <span className="muted">version {year.version}</span>}
      </span>
      <span title={synced ? new Date(synced).toLocaleString() : undefined}>
        {synced
          ? `Last synced ${now === null ? "" : timeAgo(synced, now)}`
          : "Never synced"}
        {status.lastAttempt?.status === "unchanged" && !error ? ", already up to date" : ""}
      </span>
      {error && (
        <span className="down" role="alert">
          Last sync failed: {error}
        </span>
      )}
      <button type="button" className="btn" onClick={sync} disabled={busy}>
        {busy ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}
