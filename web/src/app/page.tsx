import { Calculator } from "@/components/Calculator";
import { EmptyState } from "@/components/EmptyState";
import { defaultState } from "@/lib/profile";
import { loadSavedState } from "@/server/profile";
import { firstSync, getBundle, getSyncStatus } from "@/server/sync";

export const dynamic = "force-dynamic";

export default async function Page() {
  // The first request waits for the startup sync so there is data to show.
  await firstSync();
  const status = getSyncStatus();
  const bundle = getBundle();
  if (!bundle) return <EmptyState status={status} />;

  const saved = loadSavedState();
  const state = saved && bundle.states[saved.profile.state] ? saved : defaultState;
  return <Calculator initialBundle={bundle} initialStatus={status} initialState={state} />;
}
