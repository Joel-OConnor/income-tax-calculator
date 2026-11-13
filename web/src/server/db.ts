import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.TAX_DB_PATH ?? path.join(process.cwd(), "data", "tax.db");

// Each year's validated dataset bundle is stored whole. The engine consumes the
// bundle as one document, so splitting it into relational tables would only
// mean reassembling it on every read.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS tax_bundle (
    tax_year       INTEGER PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    sha256         TEXT NOT NULL,
    data           TEXT NOT NULL,
    source         TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sync_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at  TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    trigger     TEXT NOT NULL,
    source      TEXT NOT NULL,
    status      TEXT NOT NULL,
    updated     TEXT NOT NULL,
    error       TEXT
  );
  CREATE TABLE IF NOT EXISTS profile (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    data       TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

// Kept on globalThis so dev-mode module reloads reuse one connection.
const holder = globalThis as unknown as { taxDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (!holder.taxDb) {
    mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const database = new DatabaseSync(DB_PATH);
    database.exec("PRAGMA journal_mode = WAL;");
    database.exec(SCHEMA);
    holder.taxDb = database;
  }
  return holder.taxDb;
}
