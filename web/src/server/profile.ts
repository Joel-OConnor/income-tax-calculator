import { SavedStateSchema } from "@/lib/profile";
import type { SavedState } from "@/lib/profile";
import { db } from "./db";

/** The saved inputs, or null when there are none or they no longer fit the schema. */
export function loadSavedState(): SavedState | null {
  const row = db().prepare("SELECT data FROM profile WHERE id = 1").get() as
    | { data: string }
    | undefined;
  if (!row) return null;
  try {
    const parsed = SavedStateSchema.safeParse(JSON.parse(row.data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function storeSavedState(state: SavedState): void {
  db()
    .prepare(
      `INSERT INTO profile (id, data, updated_at) VALUES (1, ?, ?)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(JSON.stringify(state), new Date().toISOString());
}
