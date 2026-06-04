#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

export const STATUSES = ["queued", "running", "blocked", "paused", "completed", "failed", "cancelled"];
const ID_RE = /^[a-z0-9._-]+$/;
const CONFIG_FILE = ".autoloop.json";
const LEGACY_CONFIG_FILE = ".daloop.json"; // back-compat: pre-rename config name
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
      const val = (next === undefined || next.startsWith("--")) ? true : (i++, next);
      if (key in flags) flags[key] = [].concat(flags[key], val); // repeated -> array
      else flags[key] = val;
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

export function asArray(v) { return v === undefined ? [] : Array.isArray(v) ? v : [v]; }
function oneFlag(name, v) { if (Array.isArray(v)) throw new UsageError(`--${name} may only be given once`); return v; }
function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "doc"; }

export function validateStatus(s) {
  if (!STATUSES.includes(s)) throw new UsageError(`invalid status '${s}' (expected one of: ${STATUSES.join(", ")})`);
}
export function validateId(name, v) {
  if (typeof v !== "string" || !ID_RE.test(v)) throw new UsageError(`invalid ${name} '${v}' (must match ${ID_RE})`);
}

export function loadConfig(cwd) {
  // Prefer the new config; fall back to the legacy .daloop.json so pre-rename setups keep working.
  let p = join(cwd, CONFIG_FILE);
  if (!existsSync(p)) {
    const legacy = join(cwd, LEGACY_CONFIG_FILE);
    if (existsSync(legacy)) p = legacy;
    else throw new UsageError("not initialized — run `autoloop init`");
  }
  return JSON.parse(readFileSync(p, "utf8"));
}
export function saveConfig(cwd, cfg) {
  writeFileSync(join(cwd, CONFIG_FILE), JSON.stringify(cfg, null, 2) + "\n");
}

export function parseGitHead(out) {
  const [sha = "", committedAt = "", author = "", ...rest] = out.split("\n");
  return { sha, committedAt, author, message: rest.join("\n") };
}

function defaultGitRun(cwd) {
  return execFileSync("git", ["log", "-1", "--format=%H%n%cI%n%an%n%s"], { cwd, encoding: "utf8" }).trim();
}

export function resolveApiUrl(cfg, env, flagUrl) {
  return (typeof flagUrl === "string" && flagUrl) || env.AUTOLOOP_API_URL || cfg.apiUrl;
}

/** Loop path segment for run-data URLs: "/loops/<id>" when a loop is current, else "" (legacy). */
export function loopSeg(cfg) {
  return cfg.currentLoopId ? `/loops/${cfg.currentLoopId}` : "";
}

const REPORT_MESSAGES = {
  401: () => "invalid or expired AUTOLOOP_API_KEY",
  403: (teamId) => `your API key's user is not a member of team ${teamId ?? "(unknown)"}`,
  404: () => "team/project/phase not found — run `autoloop project set` first",
};

/**
 * Send one report request. deps: { env, fetchImpl, err, strict, teamId }.
 * Returns 0 on success; on failure prints a one-line warning and returns 0,
 * or 1 when strict. Throws UsageError (caught by run -> exit 1) for a missing key.
 */
export async function report(req, deps) {
  const { env = process.env, fetchImpl = fetch, err = (m) => console.error(m), strict = false, teamId } = deps;
  const key = env.AUTOLOOP_API_KEY;
  if (!key) throw new UsageError("set AUTOLOOP_API_KEY (a key minted via POST /v1/keys)");

  let res;
  try {
    res = await fetchImpl(req.url, {
      method: req.method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(req.body),
    });
  } catch (e) {
    err(`autoloop: report failed (network): ${e.message}`);
    return strict ? 1 : 0;
  }

  if (res.ok) {
    try {
      const b = await res.json();
      if (Array.isArray(b?.pendingMessages) && b.pendingMessages.length) {
        err(`autoloop: 📨 ${b.pendingMessages.length} message(s) from the user — run \`autoloop messages pull\``);
      }
    } catch { /* ignore — many stubs have no json() or no pendingMessages */ }
    return 0;
  }

  let detail = "";
  if (res.status === 400) {
    try { detail = (await res.json())?.error?.message ?? ""; } catch { /* ignore */ }
  }
  const m = REPORT_MESSAGES[res.status];
  const msg = m ? m(teamId) : `HTTP ${res.status}`;
  err(`autoloop: report not applied (${res.status}): ${msg}${detail ? ` — ${detail}` : ""}`);
  return strict ? 1 : 0;
}

/**
 * Fetch JSON from a GET endpoint and print the parsed result to stdout via log.
 * Best-effort: never throws; on failure prints a warning to err and returns 0.
 * deps: { env, fetchImpl, log, err }.
 */
export async function fetchJson(req, deps) {
  const { env = process.env, fetchImpl = fetch, log = (m) => console.log(m), err = (m) => console.error(m) } = deps;
  const key = env.AUTOLOOP_API_KEY;
  if (!key) throw new UsageError("set AUTOLOOP_API_KEY (a key minted via POST /v1/keys)");

  let res;
  try {
    res = await fetchImpl(req.url, {
      method: req.method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    });
  } catch (e) {
    err(`autoloop: messages pull failed (network): ${e.message}`);
    return 0;
  }

  if (res.ok) {
    try {
      const body = await res.json();
      log(JSON.stringify(body.messages ?? body, null, 2));
    } catch (e) {
      err(`autoloop: messages pull failed (parse): ${e.message}`);
    }
    return 0;
  }

  err(`autoloop: messages pull failed (${res.status})`);
  return 0;
}

/**
 * Run an autoloop command. Returns an exit code (0 ok, 1 usage error).
 * deps: { cwd, env, fetchImpl, gitRun, log, err } — all injectable for tests.
 */
export async function run(argv, deps = {}) {
  const {
    cwd = process.cwd(),
    fetchImpl = fetch,
    gitRun,
    log = (m) => console.log(m),
    err = (m) => console.error(m),
  } = deps;

  // Back-compat: accept the pre-rename DALOOP_* env vars as fallbacks for AUTOLOOP_*.
  // Normalizing here means every downstream `env.AUTOLOOP_*` read (report/fetchJson/
  // resolveApiUrl/strict checks) transparently picks up the legacy value.
  const rawEnv = deps.env ?? process.env;
  const env = {
    ...rawEnv,
    AUTOLOOP_API_KEY: rawEnv.AUTOLOOP_API_KEY ?? rawEnv.DALOOP_API_KEY,
    AUTOLOOP_API_URL: rawEnv.AUTOLOOP_API_URL ?? rawEnv.DALOOP_API_URL,
    AUTOLOOP_STRICT: rawEnv.AUTOLOOP_STRICT ?? rawEnv.DALOOP_STRICT,
  };

  const { positionals, flags } = parseArgs(argv);
  const [cmd, sub] = positionals;

  try {
    // Single-word verbs may take a positional arg (e.g. `score <scenarioId>`), so they
    // must NOT fold the positional into the dispatch key. Two-word verbs (e.g. `phase start`) do.
    const ONE_WORD = new Set(["init", "commit", "score", "test-run", "revise"]);
    const dispatchKey = ONE_WORD.has(cmd) ? cmd : `${cmd} ${sub ?? ""}`.trim();
    switch (dispatchKey) {
      case "init": {
        const teamId = flags.team, projectSlug = flags.project;
        if (!teamId || !projectSlug) throw new UsageError("init requires --team <teamId> --project <slug>");
        validateId("teamId", teamId);
        validateId("projectSlug", projectSlug);
        const apiUrl = (typeof flags.url === "string" && flags.url) || DEFAULT_API_URL;
        saveConfig(cwd, { apiUrl, teamId, projectSlug, currentLoopId: null, loops: {}, currentPhaseId: null, currentTaskId: null, phases: {}, tasks: {} });
        log(`autoloop: initialized .autoloop.json (team=${teamId}, project=${projectSlug})`);
        return 0;
      }
      case "project set": {
        const cfg = loadConfig(cwd);
        validateId("teamId", cfg.teamId);
        validateId("projectSlug", cfg.projectSlug);
        const body = {};
        if (flags.title) body.title = flags.title;
        if (flags.status) { validateStatus(flags.status); body.status = flags.status; }
        if (flags["design-file"]) {
          let content;
          try { content = readFileSync(join(cwd, flags["design-file"]), "utf8"); }
          catch (e) { throw new UsageError(`could not read --design-file '${flags["design-file"]}': ${e.message}`); }
          body.design = { format: "markdown", content };
        } else if (flags["design-url"]) {
          body.design = { format: "url", content: flags["design-url"] };
        }
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}`;
        return report({ method: "PUT", url, body }, { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "phase start": {
        const phaseId = positionals[2];
        validateId("phaseId", phaseId);
        if (!flags.name || typeof flags.order !== "string") throw new UsageError("phase start requires --name <n> --order <number>");
        const order = Number(flags.order);
        if (!Number.isInteger(order)) throw new UsageError(`--order must be an integer, got '${flags.order}'`);
        const status = flags.status || "queued";
        validateStatus(status);
        const cfg = loadConfig(cwd);
        cfg.phases = cfg.phases || {};
        cfg.phases[phaseId] = { name: flags.name, order };
        cfg.currentPhaseId = phaseId;
        saveConfig(cwd, cfg);
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}${loopSeg(cfg)}/phases/${phaseId}`;
        return report({ method: "PUT", url, body: { name: flags.name, order, status } },
          { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "phase set": {
        const phaseId = positionals[2];
        validateId("phaseId", phaseId);
        if (!flags.status) throw new UsageError("phase set requires --status <s>");
        validateStatus(flags.status);
        const cfg = loadConfig(cwd);
        const rec = cfg.phases?.[phaseId];
        if (!rec) throw new UsageError(`phase ${phaseId} not started — run \`autoloop phase start\` first`);
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}${loopSeg(cfg)}/phases/${phaseId}`;
        return report({ method: "PUT", url, body: { name: rec.name, order: rec.order, status: flags.status } },
          { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "loop start": {
        const loopId = positionals[2]; validateId("loopId", loopId);
        if (!flags.goal || typeof flags.order !== "string") throw new UsageError("loop start requires --goal <text> --order <number>");
        const order = Number(flags.order);
        if (!Number.isInteger(order)) throw new UsageError(`--order must be an integer, got '${flags.order}'`);
        const status = flags.status || "running";
        validateStatus(status);
        const cfg = loadConfig(cwd);
        cfg.loops = cfg.loops || {};
        cfg.loops[loopId] = { goal: flags.goal, order };
        cfg.currentLoopId = loopId;
        saveConfig(cwd, cfg);
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/loops/${loopId}`;
        return report({ method: "PUT", url, body: { goal: flags.goal, order, status } },
          { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "loop set": {
        const loopId = positionals[2]; validateId("loopId", loopId);
        if (!flags.status) throw new UsageError("loop set requires --status <s>");
        validateStatus(flags.status);
        const cfg = loadConfig(cwd);
        const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];
        if (TERMINAL_STATUSES.includes(flags.status)) {
          cfg.currentLoopId = null;
          saveConfig(cwd, cfg);
        }
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/loops/${loopId}`;
        return report({ method: "PUT", url, body: { status: flags.status } },
          { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "goal set": {
        const id = positionals[2]; validateId("goalId", id);
        const cfg = loadConfig(cwd);
        const body = {};
        if (flags.title) body.title = flags.title;
        if (flags.description) body.description = flags.description;
        if (typeof flags.order === "string") body.order = Number(flags.order);
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/goals/${id}`;
        return report({ method: "PUT", url, body }, { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "scenario set": {
        const id = positionals[2]; validateId("scenarioId", id);
        const cfg = loadConfig(cwd);
        const body = {};
        if (flags.goal) body.goalId = flags.goal;
        if (flags.title) body.title = flags.title;
        if (flags.description) body.description = flags.description;
        if (typeof flags.order === "string") body.order = Number(flags.order);
        if (typeof flags.threshold === "string") body.threshold = Number(flags.threshold);
        if (flags.rubric) {
          if (typeof flags.rubric !== "string") throw new UsageError("--rubric requires a file path");
          try { body.rubric = JSON.parse(readFileSync(join(cwd, flags.rubric), "utf8")); }
          catch (e) { throw new UsageError(`could not read --rubric '${flags.rubric}': ${e.message}`); }
        }
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/scenarios/${id}`;
        return report({ method: "PUT", url, body }, { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "task start": {
        const id = positionals[2]; validateId("taskId", id);
        if (!flags.phase || !flags.name || typeof flags.order !== "string") throw new UsageError("task start requires --phase <p> --name <n> --order <number>");
        validateId("phase", flags.phase);
        const order = Number(flags.order);
        if (!Number.isInteger(order)) throw new UsageError(`--order must be an integer, got '${flags.order}'`);
        const scenarioIds = flags.scenarios ? String(flags.scenarios).split(",").filter(Boolean) : [];
        const cfg = loadConfig(cwd);
        cfg.tasks = cfg.tasks || {};
        cfg.tasks[id] = { phaseId: flags.phase, title: flags.name, order };
        cfg.currentTaskId = id;
        saveConfig(cwd, cfg);
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}${loopSeg(cfg)}/tasks/${id}`;
        const taskStatus = flags.status || "queued";
        validateStatus(taskStatus);
        return report({ method: "PUT", url, body: { phaseId: flags.phase, title: flags.name, order, status: taskStatus, scenarioIds } },
          { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "task set": {
        const id = positionals[2]; validateId("taskId", id);
        if (!flags.status) throw new UsageError("task set requires --status <s>");
        validateStatus(flags.status);
        const cfg = loadConfig(cwd);
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}${loopSeg(cfg)}/tasks/${id}`;
        return report({ method: "PUT", url, body: { status: flags.status } },
          { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "doc add": {
        if (!flags.kind || !flags.title) throw new UsageError("doc add requires --kind <k> --title <t>");
        if (!flags.file && !flags.url) throw new UsageError("doc add requires --file <path> or --url <url>");
        const cfg = loadConfig(cwd);
        let format, content;
        if (flags.file) {
          try { content = readFileSync(join(cwd, flags.file), "utf8"); }
          catch (e) { throw new UsageError(`could not read --file '${flags.file}': ${e.message}`); }
          format = "markdown";
        } else { format = "url"; content = flags.url; }
        const docId = flags.id ? (validateId("docId", flags.id), flags.id) : slugify(flags.title);
        // NOTE: --url is overloaded here (it's the DOCUMENT url, not an API-base override),
        // so resolve the API base from cfg/env only — pass `undefined` as the flag override.
        const url = `${resolveApiUrl(cfg, env, undefined)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/documents/${docId}`;
        return report({ method: "PUT", url, body: { kind: flags.kind, title: flags.title, format, content } },
          { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "bug add": {
        const id = positionals[2]; validateId("bugId", id);
        if (!flags.title) throw new UsageError("bug add requires --title <t>");
        const status = flags.status || "open";
        if (!["open", "fixed"].includes(status)) throw new UsageError(`--status must be open|fixed, got '${status}'`);
        const body = { title: flags.title, status };
        if (flags.scenario) { validateId("scenario", flags.scenario); body.scenarioId = flags.scenario; }
        if (flags.task) { validateId("task", flags.task); body.taskId = flags.task; }
        if (flags.severity) {
          if (!["low", "medium", "high"].includes(flags.severity)) throw new UsageError(`--severity must be low|medium|high, got '${flags.severity}'`);
          body.severity = flags.severity;
        }
        if (flags.description) body.description = flags.description;
        const cfg = loadConfig(cwd);
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}${loopSeg(cfg)}/bugs/${id}`;
        return report({ method: "PUT", url, body },
          { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "bug set": {
        const id = positionals[2]; validateId("bugId", id);
        const body = {};
        if (flags.status) {
          if (!["open", "fixed"].includes(flags.status)) throw new UsageError(`--status must be open|fixed, got '${flags.status}'`);
          body.status = flags.status;
        }
        if (flags.title) body.title = flags.title;
        if (flags.severity) {
          if (!["low", "medium", "high"].includes(flags.severity)) throw new UsageError(`--severity must be low|medium|high, got '${flags.severity}'`);
          body.severity = flags.severity;
        }
        if (flags.description) body.description = flags.description;
        if (Object.keys(body).length === 0) throw new UsageError("bug set requires at least one of --status/--title/--severity/--description");
        const cfg = loadConfig(cwd);
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}${loopSeg(cfg)}/bugs/${id}`;
        return report({ method: "PUT", url, body },
          { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "commit": {
        oneFlag("task", flags.task);
        const cfg = loadConfig(cwd);
        const apiBase = resolveApiUrl(cfg, env, flags.url);
        const strict = !!flags.strict || env.AUTOLOOP_STRICT === "1";
        let taskId = (typeof flags.task === "string" && flags.task) || cfg.currentTaskId || null;
        if (taskId) validateId("taskId", taskId);
        if (!taskId) {
          if (!cfg.currentPhaseId) throw new UsageError("no current phase — run `autoloop phase start` (or pass --task)");
          taskId = "main";
          const taskUrl = `${apiBase}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}${loopSeg(cfg)}/tasks/${taskId}`;
          const tcode = await report({ method: "PUT", url: taskUrl, body: { phaseId: cfg.currentPhaseId, title: "Main", order: 0, status: "queued", scenarioIds: [] } },
            { env, fetchImpl, err, strict, teamId: cfg.teamId });
          if (strict && tcode !== 0) return tcode;
          cfg.currentTaskId = taskId; cfg.tasks = cfg.tasks || {}; cfg.tasks[taskId] = { phaseId: cfg.currentPhaseId, title: "Main", order: 0 };
          saveConfig(cwd, cfg);
        }
        let raw;
        try { raw = (gitRun ? gitRun(cwd) : defaultGitRun(cwd)).trim(); }
        catch (e) { throw new UsageError(`could not read git HEAD (is this a git repo with commits?): ${e.message}`); }
        const c = parseGitHead(raw);
        validateId("sha", c.sha);
        if (!c.author) throw new UsageError("git author empty — set `git config user.name`");
        if (!c.message) throw new UsageError("git commit message empty");
        const url = `${apiBase}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}${loopSeg(cfg)}/tasks/${taskId}/commits/${c.sha}`;
        return report({ method: "PUT", url, body: { message: c.message, author: c.author, committedAt: c.committedAt } },
          { env, fetchImpl, err, strict, teamId: cfg.teamId });
      }
      case "score": {
        oneFlag("task", flags.task); oneFlag("composite", flags.composite);
        const scenarioId = positionals[1]; validateId("scenarioId", scenarioId);
        if (!flags.task) throw new UsageError("score requires --task <taskId>");
        if (typeof flags.composite !== "string") throw new UsageError("score requires --composite <0..100>");
        validateId("task", flags.task);
        const criteria = {};
        for (const pair of asArray(flags.criterion)) {
          const [k, v] = String(pair).split("=");
          if (!k || v === undefined) throw new UsageError(`--criterion must be key=value, got '${pair}'`);
          criteria[k] = Number(v);
        }
        const body = { scenarioId, taskId: flags.task, criteria, composite: Number(flags.composite) };
        if (flags.commit) body.commitSha = flags.commit;
        if (flags.note) body.note = flags.note;
        const cfg = loadConfig(cwd);
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}${loopSeg(cfg)}/scores`;
        return report({ method: "POST", url, body }, { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "test-run": {
        oneFlag("task", flags.task);
        const scenarioId = positionals[1]; validateId("scenarioId", scenarioId);
        if (!flags.task || typeof flags.passed !== "string" || typeof flags.failed !== "string") throw new UsageError("test-run requires --task <t> --passed <n> --failed <n>");
        validateId("task", flags.task);
        const body = { scenarioId, taskId: flags.task, passed: Number(flags.passed), failed: Number(flags.failed), issues: asArray(flags.issue).map(String) };
        if (flags["summary-file"]) {
          try { body.summary = readFileSync(join(cwd, flags["summary-file"]), "utf8"); }
          catch (e) { throw new UsageError(`could not read --summary-file '${flags["summary-file"]}': ${e.message}`); }
        } else if (flags.summary) {
          body.summary = flags.summary;
        }
        const cfg = loadConfig(cwd);
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}${loopSeg(cfg)}/testRuns`;
        return report({ method: "POST", url, body }, { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "revise": {
        oneFlag("scenario", flags.scenario);
        if (!flags.scenario || !flags.reason) throw new UsageError("revise requires --scenario <s> --reason <text>");
        validateId("scenario", flags.scenario);
        const changes = asArray(flags.change).map((spec) => {
          const [op, taskId] = String(spec).split(":");
          if (!["add", "replace", "reorder", "drop"].includes(op) || !taskId) throw new UsageError(`--change must be op:taskId (op add|replace|reorder|drop), got '${spec}'`);
          return { op, taskId };
        });
        if (changes.length === 0) throw new UsageError("revise requires at least one --change op:taskId");
        const body = { trigger: { scenarioId: flags.scenario, reason: flags.reason }, changes };
        const cfg = loadConfig(cwd);
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}${loopSeg(cfg)}/revisions`;
        return report({ method: "POST", url, body }, { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "vision import": {
        oneFlag("file", flags.file);
        if (!flags.file) throw new UsageError("vision import requires --file <vision.json>");
        const cfg = loadConfig(cwd);
        let vision;
        try { vision = JSON.parse(readFileSync(join(cwd, flags.file), "utf8")); }
        catch (e) { throw new UsageError(`could not read --file '${flags.file}': ${e.message}`); }
        const apiBase = resolveApiUrl(cfg, env, flags.url);
        const strict = !!flags.strict || env.AUTOLOOP_STRICT === "1";
        const reportDeps = { env, fetchImpl, err, strict, teamId: cfg.teamId };
        const proj = `${apiBase}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}`;
        let worst = 0;
        for (const g of vision.goals ?? []) {
          validateId("goalId", g.id);
          const { id, ...body } = g;
          worst = Math.max(worst, await report({ method: "PUT", url: `${proj}/goals/${id}`, body }, reportDeps));
        }
        for (const s of vision.scenarios ?? []) {
          validateId("scenarioId", s.id);
          // `test` is a loop-local hint (how /autoloop-loop tests the scenario), not part
          // of the contract — strip it client-side so the import body never carries it.
          const { id, test, ...body } = s;
          worst = Math.max(worst, await report({ method: "PUT", url: `${proj}/scenarios/${id}`, body }, reportDeps));
        }
        for (const d of vision.documents ?? []) {
          validateId("docId", d.id);
          const { id, ...body } = d;
          worst = Math.max(worst, await report({ method: "PUT", url: `${proj}/documents/${id}`, body }, reportDeps));
        }
        return worst; // best-effort: 0 unless strict and some report failed
      }
      case "messages pull": {
        const cfg = loadConfig(cwd);
        const api = resolveApiUrl(cfg, env, flags.url);
        const url = `${api}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/messages`;
        return fetchJson({ method: "GET", url }, { env, fetchImpl, log, err });
      }
      case "messages ack": {
        const id = positionals[2];
        if (!id || typeof id !== "string" || id.trim() === "") throw new UsageError("messages ack requires a non-empty message id");
        const cfg = loadConfig(cwd);
        const api = resolveApiUrl(cfg, env, flags.url);
        const url = `${api}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/messages/${id}/ack`;
        return report({ method: "POST", url, body: {} }, { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "messages send": {
        if (!flags.text) throw new UsageError("messages send requires --text");
        const cfg = loadConfig(cwd);
        const api = resolveApiUrl(cfg, env, flags.url);
        const url = `${api}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/messages`;
        return report({ method: "POST", url, body: { text: flags.text } }, { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "state": {
        const cfg = loadConfig(cwd);
        if (flags["current-loop"]) {
          if (cfg.currentLoopId) log(cfg.currentLoopId);
          return 0;
        }
        throw new UsageError("state requires --current-loop");
      }
      // commands added in later tasks
      default:
        throw new UsageError(`unknown command: ${argv.join(" ")}`);
    }
  } catch (e) {
    if (e instanceof UsageError) { err(`autoloop: ${e.message}`); return 1; }
    throw e;
  }
}

// Entry point (only when run directly, not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => { console.error(`autoloop: unexpected error: ${e.message}`); process.exit(1); });
}
