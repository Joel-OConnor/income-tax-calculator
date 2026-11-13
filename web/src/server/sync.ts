import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Bundle, Manifest } from "@dataset/schema.ts";
import { db } from "./db";

export interface SyncStatus {
  /** Where tax data is pulled from: a URL, or a folder on this machine. */
  source: string;
  sourceKind: "remote" | "local";
  lastAttempt: {
    at: string;
    trigger: string;
    status: "updated" | "unchanged" | "error";
    updatedYears: number[];
    error: string | null;
  } | null;
  /** When data was last pulled without error, whether or not anything changed. */
  lastSuccessAt: string | null;
  years: { taxYear: number; version: string; updatedAt: string }[];
}

/**
 * Tax data comes from TAX_DATA_URL when set (the folder holding manifest.json),
 * otherwise from the dataset built in this repository.
 */
function dataSource(): { location: string; kind: "remote" | "local" } {
  const url = process.env.TAX_DATA_URL;
  if (url) return { location: url.endsWith("/") ? url : `${url}/`, kind: "remote" };
  return {
    location: path.resolve(/* turbopackIgnore: true */ process.cwd(), "..", "dataset", "dist"),
    kind: "local",
  };
}

async function readSource(file: string): Promise<string> {
  const { location, kind } = dataSource();
  // The folder is chosen at run time, so the bundler is told not to trace it.
  if (kind === "local") {
    return readFile(path.join(/* turbopackIgnore: true */ location, file), "utf8");
  }
  const response = await fetch(new URL(file, location), {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.text();
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

async function pull(): Promise<number[]> {
  const manifest = Manifest.parse(JSON.parse(await readSource("manifest.json")));
  const stored = new Map(
    (db().prepare("SELECT tax_year, sha256 FROM tax_bundle").all() as {
      tax_year: number;
      sha256: string;
    }[]).map((row) => [row.tax_year, row.sha256]),
  );

  // Download and validate everything first. Nothing is written unless every
  // changed year is intact and matches the schema.
  const changed: { taxYear: number; sha: string; data: string; schemaVersion: number }[] = [];
  for (const year of manifest.years) {
    if (stored.get(year.taxYear) === year.sha256) continue;
    const text = await readSource(year.file);
    if (sha256(text) !== year.sha256) {
      throw new Error(`${year.file} does not match the hash in the manifest`);
    }
    const bundle = Bundle.parse(JSON.parse(text));
    if (bundle.taxYear !== year.taxYear) {
      throw new Error(`${year.file} holds tax year ${bundle.taxYear}, expected ${year.taxYear}`);
    }
    changed.push({
      taxYear: year.taxYear,
      sha: year.sha256,
      data: JSON.stringify(bundle),
      schemaVersion: bundle.schemaVersion,
    });
  }

  if (changed.length > 0) {
    const database = db();
    const upsert = database.prepare(
      `INSERT INTO tax_bundle (tax_year, schema_version, sha256, data, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (tax_year) DO UPDATE SET
         schema_version = excluded.schema_version, sha256 = excluded.sha256,
         data = excluded.data, source = excluded.source, updated_at = excluded.updated_at`,
    );
    const now = new Date().toISOString();
    database.exec("BEGIN");
    try {
      for (const c of changed) {
        upsert.run(c.taxYear, c.schemaVersion, c.sha, c.data, dataSource().location, now);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  return changed.map((c) => c.taxYear);
}

async function runSync(trigger: "startup" | "manual"): Promise<SyncStatus> {
  const startedAt = new Date().toISOString();
  let status: "updated" | "unchanged" | "error";
  let updated: number[] = [];
  let error: string | null = null;
  try {
    updated = await pull();
    status = updated.length > 0 ? "updated" : "unchanged";
  } catch (e) {
    status = "error";
    error = e instanceof Error ? e.message : String(e);
  }
  db()
    .prepare(
      `INSERT INTO sync_log (started_at, finished_at, trigger, source, status, updated, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      startedAt,
      new Date().toISOString(),
      trigger,
      dataSource().location,
      status,
      JSON.stringify(updated),
      error,
    );
  return getSyncStatus();
}

const holder = globalThis as unknown as {
  taxSyncInFlight?: Promise<SyncStatus> | null;
  taxSyncFirst?: Promise<SyncStatus>;
};

/** Pulls tax data. Calls made while a sync is running share that run. */
export function syncTaxData(trigger: "startup" | "manual"): Promise<SyncStatus> {
  holder.taxSyncInFlight ??= runSync(trigger).finally(() => {
    holder.taxSyncInFlight = null;
  });
  return holder.taxSyncInFlight;
}

/** Resolves once the first sync of this server process has finished. */
export function firstSync(): Promise<SyncStatus> {
  holder.taxSyncFirst ??= syncTaxData("startup");
  return holder.taxSyncFirst;
}

export function getSyncStatus(): SyncStatus {
  const database = db();
  const last = database
    .prepare("SELECT * FROM sync_log ORDER BY id DESC LIMIT 1")
    .get() as
    | { finished_at: string; trigger: string; status: string; updated: string; error: string | null }
    | undefined;
  const lastSuccess = database
    .prepare("SELECT finished_at FROM sync_log WHERE status != 'error' ORDER BY id DESC LIMIT 1")
    .get() as { finished_at: string } | undefined;
  const years = database
    .prepare("SELECT tax_year, sha256, updated_at FROM tax_bundle ORDER BY tax_year DESC")
    .all() as { tax_year: number; sha256: string; updated_at: string }[];
  const { location, kind } = dataSource();
  return {
    source: location,
    sourceKind: kind,
    lastAttempt: last
      ? {
          at: last.finished_at,
          trigger: last.trigger,
          status: last.status as "updated" | "unchanged" | "error",
          updatedYears: JSON.parse(last.updated) as number[],
          error: last.error,
        }
      : null,
    lastSuccessAt: lastSuccess?.finished_at ?? null,
    years: years.map((y) => ({
      taxYear: y.tax_year,
      version: y.sha256.slice(0, 8),
      updatedAt: y.updated_at,
    })),
  };
}

/**
 * The stored bundle for a tax year, or for the latest year when none is given.
 * Null when there is none or it does not fit the current schema.
 */
export function getBundle(taxYear?: number): Bundle | null {
  const row = (
    taxYear === undefined
      ? db().prepare("SELECT data FROM tax_bundle ORDER BY tax_year DESC LIMIT 1").get()
      : db().prepare("SELECT data FROM tax_bundle WHERE tax_year = ?").get(taxYear)
  ) as { data: string } | undefined;
  if (!row) return null;
  // Data stored by an older version of the app may not fit today's schema.
  // Treat it as missing so the page asks for a sync rather than failing.
  const parsed = Bundle.safeParse(JSON.parse(row.data));
  return parsed.success ? parsed.data : null;
}
