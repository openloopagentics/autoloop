#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const STATUSES = ["queued", "running", "blocked", "paused", "completed", "failed", "cancelled"];
const ID_RE = /^[a-z0-9._-]+$/;
const CONFIG_FILE = ".daloop.json";
export const DEFAULT_API_URL = "https://api-5ds5e4zsxq-uc.a.run.app";

/** Thrown for caller-fixable problems; surfaced as exit code 1 BEFORE any network call. */
export class UsageError extends Error {}

export function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) { flags[key] = true; }
      else { flags[key] = next; i++; }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

export function validateStatus(s) {
  if (!STATUSES.includes(s)) throw new UsageError(`invalid status '${s}' (expected one of: ${STATUSES.join(", ")})`);
}
export function validateId(name, v) {
  if (typeof v !== "string" || !ID_RE.test(v)) throw new UsageError(`invalid ${name} '${v}' (must match ${ID_RE})`);
}

export function loadConfig(cwd) {
  const p = join(cwd, CONFIG_FILE);
  if (!existsSync(p)) throw new UsageError("not initialized — run `daloop init`");
  return JSON.parse(readFileSync(p, "utf8"));
}
export function saveConfig(cwd, cfg) {
  writeFileSync(join(cwd, CONFIG_FILE), JSON.stringify(cfg, null, 2) + "\n");
}

/**
 * Run a daloop command. Returns an exit code (0 ok, 1 usage error).
 * deps: { cwd, env, fetchImpl, gitRun, log, err } — all injectable for tests.
 */
export async function run(argv, deps = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    fetchImpl = fetch,
    gitRun,
    log = (m) => console.log(m),
    err = (m) => console.error(m),
  } = deps;

  const { positionals, flags } = parseArgs(argv);
  const [cmd, sub] = positionals;

  try {
    switch (`${cmd} ${sub ?? ""}`.trim()) {
      // commands added in later tasks
      default:
        throw new UsageError(`unknown command: ${argv.join(" ")}`);
    }
  } catch (e) {
    if (e instanceof UsageError) { err(`daloop: ${e.message}`); return 1; }
    throw e;
  }
}

// Entry point (only when run directly, not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
