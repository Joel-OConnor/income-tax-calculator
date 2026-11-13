// Validates the source files under src/<year>/ and bundles each year into
// dist/<year>.json, plus dist/manifest.json listing every year with its hash.
// The app syncs from dist/.
//
//   node build.ts                     validate everything and write dist/
//   node build.ts --check <file>...   validate only the given source files, write nothing

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { z } from "zod";
import { Bundle, Federal, Manifest, SCHEMA_VERSION, State } from "./schema.ts";
import type { Confidence } from "./schema.ts";

const root = import.meta.dirname;
const srcDir = join(root, "src");
const distDir = join(root, "dist");

const errors: string[] = [];
const fail = (file: string, message: string) =>
  errors.push(`${relative(root, file)}: ${message}`);

function parseFile<T>(schema: z.ZodType<T>, file: string): T | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    fail(file, `not readable as JSON (${(e as Error).message})`);
    return undefined;
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    fail(file, `\n${z.prettifyError(result.error)}`);
    return undefined;
  }
  return result.data;
}

type Group = {
  jurisdiction: string;
  path: string;
  cites: string[];
  confidence: Confidence;
  valuesTaxYear?: number;
};

/** Finds every cited group of values in a parsed file. */
function collectGroups(node: unknown, path: string, jurisdiction: string, out: Group[]): Group[] {
  if (Array.isArray(node)) {
    node.forEach((child, i) => collectGroups(child, `${path}[${i}]`, jurisdiction, out));
  } else if (node !== null && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.cites) && typeof record.confidence === "string") {
      out.push({
        jurisdiction,
        path,
        cites: record.cites as string[],
        confidence: record.confidence as Confidence,
        valuesTaxYear: record.valuesTaxYear as number | undefined,
      });
    }
    for (const [key, value] of Object.entries(record)) {
      if (key !== "sources") {
        collectGroups(value, path ? `${path}.${key}` : key, jurisdiction, out);
      }
    }
  }
  return out;
}

/**
 * Parses one source file and runs the checks the schema cannot express:
 * file name and folder match the contents, every cite names a source in the
 * file, every source is cited, and no group claims values from a future year.
 */
function loadSource(file: string, taxYear: number) {
  const isFederal = basename(file) === "federal.json";
  const data = isFederal ? parseFile(Federal, file) : parseFile(State, file);
  if (!data) return undefined;

  if (!isFederal && data.jurisdiction !== basename(file, ".json")) {
    fail(file, `jurisdiction "${data.jurisdiction}" does not match the file name`);
  }
  if (data.taxYear !== taxYear) {
    fail(file, `taxYear is ${data.taxYear}, expected ${taxYear} from its folder`);
  }

  const groups = collectGroups(data, "", data.jurisdiction, []);
  const cited = new Set(groups.flatMap((g) => g.cites));
  for (const g of groups) {
    for (const key of g.cites) {
      if (!(key in data.sources)) fail(file, `${g.path} cites unknown source "${key}"`);
    }
    if (g.valuesTaxYear !== undefined && g.valuesTaxYear > taxYear) {
      fail(file, `${g.path} has valuesTaxYear ${g.valuesTaxYear}, later than ${taxYear}`);
    }
  }
  for (const key of Object.keys(data.sources)) {
    if (!cited.has(key)) fail(file, `source "${key}" is never cited`);
  }

  return { data, groups };
}

function printGroups(label: string, taxYear: number, groups: Group[]) {
  const count = (c: Confidence) => groups.filter((g) => g.confidence === c).length;
  console.log(label);
  console.log(
    `  ${groups.length} value groups: ${count("primary")} primary, ` +
      `${count("secondary")} secondary, ${count("unverified")} unverified`,
  );
  for (const g of groups) {
    if (g.valuesTaxYear !== undefined && g.valuesTaxYear !== taxYear) {
      console.log(`  stale: ${g.jurisdiction} ${g.path} uses ${g.valuesTaxYear} values`);
    }
  }
  for (const g of groups) {
    if (g.confidence === "unverified") console.log(`  unverified: ${g.jurisdiction} ${g.path}`);
  }
}

function exitIfErrors() {
  if (errors.length === 0) return;
  console.error(`Dataset has ${errors.length} problem(s):\n`);
  for (const e of errors) console.error(`- ${e}\n`);
  process.exit(1);
}

function checkOnly(files: string[]) {
  if (files.length === 0) {
    console.error("Usage: node build.ts --check <source file>...");
    process.exit(1);
  }
  for (const arg of files) {
    const file = resolve(arg);
    const year = /[\\/]src[\\/](\d{4})[\\/]/.exec(file)?.[1];
    if (!year) {
      fail(file, "is not under src/<year>/");
      continue;
    }
    const loaded = loadSource(file, Number(year));
    if (loaded) printGroups(`ok: ${relative(root, file)}`, Number(year), loaded.groups);
  }
  exitIfErrors();
}

function buildAll() {
  const years = readdirSync(srcDir)
    .filter((name) => /^\d{4}$/.test(name))
    .map(Number)
    .sort();

  const built: { bundle: Bundle; groups: Group[] }[] = [];
  for (const taxYear of years) {
    const yearDir = join(srcDir, String(taxYear));
    const groups: Group[] = [];

    const federal = loadSource(join(yearDir, "federal.json"), taxYear);
    if (federal) groups.push(...federal.groups);

    const states: Record<string, State> = {};
    const statesDir = join(yearDir, "states");
    const stateFiles = existsSync(statesDir)
      ? readdirSync(statesDir).filter((f) => f.endsWith(".json")).sort()
      : [];
    for (const name of stateFiles) {
      const state = loadSource(join(statesDir, name), taxYear);
      if (!state) continue;
      states[state.data.jurisdiction] = state.data as State;
      groups.push(...state.groups);
    }

    if (federal) {
      built.push({
        bundle: { schemaVersion: SCHEMA_VERSION, taxYear, federal: federal.data as Federal, states },
        groups,
      });
    }
  }
  exitIfErrors();

  mkdirSync(distDir, { recursive: true });
  const manifest: Manifest = { schemaVersion: SCHEMA_VERSION, years: [] };
  for (const { bundle, groups } of built) {
    const file = `${bundle.taxYear}.json`;
    const content = JSON.stringify(Bundle.parse(bundle)) + "\n";
    writeFileSync(join(distDir, file), content);
    const states = Object.keys(bundle.states);
    manifest.years.push({
      taxYear: bundle.taxYear,
      file,
      sha256: createHash("sha256").update(content).digest("hex"),
      states,
    });
    printGroups(`\n${bundle.taxYear}: federal + ${states.length} states (${states.join(", ")})`, bundle.taxYear, groups);
  }
  writeFileSync(
    join(distDir, "manifest.json"),
    JSON.stringify(Manifest.parse(manifest), null, 2) + "\n",
  );
  console.log(`\nWrote ${manifest.years.length} year(s) to ${relative(process.cwd(), distDir) || "."}`);
}

const args = process.argv.slice(2);
if (args[0] === "--check") checkOnly(args.slice(1));
else buildAll();
