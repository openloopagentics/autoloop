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

export function resolveApiUrl(cfg, env, flagUrl) {
  return (typeof flagUrl === "string" && flagUrl) || env.DALOOP_API_URL || cfg.apiUrl;
}

const REPORT_MESSAGES = {
  401: () => "invalid or expired DALOOP_API_KEY",
  403: (teamId) => `your API key's user is not a member of team ${teamId ?? "(unknown)"}`,
  404: () => "team/project/phase not found — run `daloop project set` first",
};

/**
 * Send one report request. deps: { env, fetchImpl, err, strict, teamId }.
 * Returns 0 on success; on failure prints a one-line warning and returns 0,
 * or 1 when strict. Throws UsageError (caught by run -> exit 1) for a missing key.
 */
export async function report(req, deps) {
  const { env = process.env, fetchImpl = fetch, err = (m) => console.error(m), strict = false, teamId } = deps;
  const key = env.DALOOP_API_KEY;
  if (!key) throw new UsageError("set DALOOP_API_KEY (a key minted via POST /v1/keys)");

  let res;
  try {
    res = await fetchImpl(req.url, {
      method: req.method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(req.body),
    });
  } catch (e) {
    err(`daloop: report failed (network): ${e.message}`);
    return strict ? 1 : 0;
  }

  if (res.ok) return 0;

  let detail = "";
  if (res.status === 400) {
    try { detail = (await res.json())?.error?.message ?? ""; } catch { /* ignore */ }
  }
  const m = REPORT_MESSAGES[res.status];
  const msg = m ? m(teamId) : `HTTP ${res.status}`;
  err(`daloop: report not applied (${res.status}): ${msg}${detail ? ` — ${detail}` : ""}`);
  return strict ? 1 : 0;
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
      case "init": {
        const teamId = flags.team, projectSlug = flags.project;
        if (!teamId || !projectSlug) throw new UsageError("init requires --team <teamId> --project <slug>");
        validateId("teamId", teamId);
        validateId("projectSlug", projectSlug);
        const apiUrl = (typeof flags.url === "string" && flags.url) || DEFAULT_API_URL;
        saveConfig(cwd, { apiUrl, teamId, projectSlug, currentPhaseId: null, phases: {} });
        log(`daloop: initialized .daloop.json (team=${teamId}, project=${projectSlug})`);
        return 0;
      }
      case "project set": {
        const cfg = loadConfig(cwd);
        validateId("teamId", cfg.teamId);
        validateId("projectSlug", cfg.projectSlug);
        const body = {};
        if (flags.title) body.title = flags.title;
        if (flags.status) { validateStatus(flags.status); body.status = flags.status; }
        if (flags["design-file"]) body.design = { format: "markdown", content: readFileSync(join(cwd, flags["design-file"]), "utf8") };
        else if (flags["design-url"]) body.design = { format: "url", content: flags["design-url"] };
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}`;
        return report({ method: "PUT", url, body }, { env, fetchImpl, err, strict: !!flags.strict || env.DALOOP_STRICT === "1", teamId: cfg.teamId });
      }
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
