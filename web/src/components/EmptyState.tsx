"use client";

import type { SyncStatus as Status } from "@/server/sync";
import { SyncStatus } from "./SyncStatus";

/** Shown when no tax data has ever been synced. A successful sync reloads the page. */
export function EmptyState({ status }: { status: Status }) {
  return (
    <main className="empty">
      <h1>Tax data needs a sync</h1>
      <p className="secondary">
        There is no tax data stored yet, or what is stored was made for an older version of this
        app. Sync to fetch the current data from <code>{status.source}</code>.
      </p>
      <SyncStatus
        status={status}
        onSynced={(_, bundle) => {
          if (bundle) window.location.reload();
        }}
      />
    </main>
  );
}
