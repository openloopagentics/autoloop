#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, realpathSync, readdirSync, rmSync, openSync, chmodSync } from "node:fs";
import { join, basename, dirname, resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync, spawn } from "node:child_process";

export const STATUSES = ["queued", "running", "blocked", "paused", "completed", "failed", "cancelled"];
export const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];
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

/**
 * Resolve a caller-supplied file path against `cwd` and confirm it stays inside it.
 * Defense-in-depth (ported from loop-engineering's mcp-server `assertSafeSegment`):
 * rejects null bytes, absolute paths, and `..` traversal that escapes the working dir.
 * Returns the absolute path on success; throws UsageError otherwise.
 */
export function assertSafePath(cwd, p, flagName = "file") {
  if (typeof p !== "string" || p.length === 0) throw new UsageError(`--${flagName} must be a non-empty path`);
  if (p.includes("\0")) throw new UsageError(`invalid --${flagName} '${p}' (null byte)`);
  if (isAbsolute(p)) throw new UsageError(`--${flagName} must be a relative path inside the project, got absolute '${p}'`);
  const abs = resolve(cwd, p);
  const rel = relative(cwd, abs);
  // `relative` yields a `..`-prefixed path iff `abs` lands outside `cwd`.
  if (rel === ".." || rel.startsWith(".." + "/") || rel.startsWith(".." + "\\")) throw new UsageError(`--${flagName} '${p}' escapes the project directory`);
  return abs;
}

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

// Network resilience defaults. Reporting is best-effort, so these stay short:
// a hung API must never wedge an agent loop, and a blip shouldn't drop a report.
export const NETWORK_TIMEOUT_MS = 30_000; // per-attempt abort
const RETRY_ATTEMPTS = 3;                  // total tries (1 initial + 2 retries)
const RETRY_BASE_MS = 300;                 // backoff: 300ms, 600ms, …
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET/PUT/DELETE are idempotent (PUT writes are upserts); POST is not, so we never
 *  retry a POST except on 429 (rate-limited = server never processed it → safe). */
function isIdempotent(method) {
  const m = (method || "GET").toUpperCase();
  return m === "GET" || m === "PUT" || m === "DELETE";
}

/**
 * fetch with a per-attempt timeout (AbortController) and bounded retries for transient
 * failures — network errors and HTTP 429/5xx. deps (all optional, defaulted): { fetchImpl,
 * sleep, attempts, baseMs, timeoutMs }. Returns the final Response-like; rethrows the last
 * error only if every attempt threw. Caller-visible behavior (4xx, success) is unchanged.
 */
export async function fetchWithRetry(url, init, deps = {}) {
  const {
    fetchImpl = fetch, sleep = realSleep,
    attempts = RETRY_ATTEMPTS, baseMs = RETRY_BASE_MS, timeoutMs = NETWORK_TIMEOUT_MS,
  } = deps;
  const idempotent = isIdempotent(init.method);
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, signal: controller.signal });
      const retryable = res && (res.status === 429 || (res.status >= 500 && idempotent));
      if (retryable && attempt < attempts - 1) { await sleep(baseMs * 2 ** attempt); continue; }
      return res;
    } catch (e) {
      lastErr = e;
      if (idempotent && attempt < attempts - 1) { await sleep(baseMs * 2 ** attempt); continue; }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

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
    res = await fetchWithRetry(req.url, {
      method: req.method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(req.body),
    }, deps);
  } catch (e) {
    err(`autoloop: report failed (network): ${e.message}`);
    return strict ? 1 : 0;
  }

  if (res.ok) {
    try {
      const b = await res.json();
      if (typeof b?.id === "string") err(`autoloop: id ${b.id}`);
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
 * Fetch JSON from a GET endpoint and print the result to stdout via log.
 * Best-effort: never throws; on failure prints a warning to err and returns 0.
 * deps: { env, fetchImpl, log, err, label?, render? } — label names the verb in
 * warnings (default "messages pull"); render(body) formats the output (default:
 * JSON of body.messages ?? body).
 */
export async function fetchJson(req, deps) {
  const {
    env = process.env, fetchImpl = fetch, log = (m) => console.log(m), err = (m) => console.error(m),
    label = "messages pull",
    render = (body) => JSON.stringify(body.messages ?? body, null, 2),
  } = deps;
  const key = env.AUTOLOOP_API_KEY;
  if (!key) throw new UsageError("set AUTOLOOP_API_KEY (a key minted via POST /v1/keys)");

  let res;
  try {
    res = await fetchWithRetry(req.url, {
      method: req.method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    }, deps);
  } catch (e) {
    err(`autoloop: ${label} failed (network): ${e.message}`);
    return 0;
  }

  if (res.ok) {
    try {
      const body = await res.json();
      log(render(body));
    } catch (e) {
      err(`autoloop: ${label} failed (parse): ${e.message}`);
    }
    return 0;
  }

  err(`autoloop: ${label} failed (${res.status})`);
  return 0;
}

/**
 * Raw GET helper: returns { ok, status, body } (body null when unparseable) or null on a
 * network error. Throws UsageError for a missing key. fetchJson stays the print-to-stdout
 * wrapper; this is the building block for verbs that need the parsed body / status.
 */
export async function getJson(url, deps) {
  const { env = process.env, fetchImpl = fetch } = deps;
  const key = env.AUTOLOOP_API_KEY;
  if (!key) throw new UsageError("set AUTOLOOP_API_KEY (a key minted via POST /v1/keys)");
  try {
    const res = await fetchWithRetry(url, { method: "GET", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` } }, deps);
    let body = null;
    try { body = await res.json(); } catch { /* no/invalid body */ }
    return { ok: res.ok, status: res.status, body };
  } catch { return null; }
}

/**
 * Fetch the resume state bundle, following the loopId fallback chain:
 * explicit → cfg.currentLoopId → the server project's currentLoopId (one extra hop via the
 * project-direct /state). Returns { state, loopId } or null on any network/HTTP failure.
 */
export async function fetchResumeState(cfg, env, fetchImpl, { loopId: explicitLoopId, urlFlag } = {}) {
  const api = resolveApiUrl(cfg, env, urlFlag);
  const base = `${api}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}`;
  const get = (id) => getJson(id ? `${base}/loops/${id}/state` : `${base}/state`, { env, fetchImpl });
  let loopId = explicitLoopId ?? cfg.currentLoopId ?? null;
  let res = await get(loopId);
  if (!loopId && res?.ok && res.body?.state?.project?.currentLoopId) {
    loopId = res.body.state.project.currentLoopId;
    res = await get(loopId);
  }
  if (!res?.ok || !res.body?.state) return null;
  return { state: res.body.state, loopId };
}

/** First non-terminal task by phase order, then task order (the driver's "next task"). */
export function firstNonTerminalTask(state) {
  const phaseOrder = new Map((state.phases ?? []).map((p) => [p.id, p.order]));
  const planOrder = [...(state.tasks ?? [])].sort((a, b) =>
    ((phaseOrder.get(a.phaseId) ?? Infinity) - (phaseOrder.get(b.phaseId) ?? Infinity)) || (a.order - b.order));
  return planOrder.find((t) => !TERMINAL_STATUSES.includes(t.status)) ?? null;
}

/** Human header: loop id/status, N/M tasks terminal, K pending messages, next task. */
export function resumeHeader(state) {
  const tasks = state.tasks ?? [];
  const terminal = tasks.filter((t) => TERMINAL_STATUSES.includes(t.status)).length;
  const next = firstNonTerminalTask(state);
  const lines = [];
  if (state.loop) lines.push(`loop ${state.loop.id} — ${state.loop.status}`);
  lines.push(`${terminal}/${tasks.length} tasks terminal, ${(state.pendingMessages ?? []).length} pending messages`);
  lines.push(next ? `next: ${next.id} — ${next.title} (phase ${next.phaseId})` : "next: none (all tasks terminal)");
  return lines.join("\n");
}

/** --check semantics: a non-terminal, NON-paused loop exists. (Paused loops are woken by
 *  the wake job on a message, not relaunched by SessionEnd.) */
export function isResumable(state) {
  const s = state?.loop?.status;
  return !!s && !TERMINAL_STATUSES.includes(s) && s !== "paused";
}

/** Locate a subagent's transcript by agentId and sum its token usage.
 *  Subagent transcripts live either directly at ~/.claude/projects/<enc>/agent-<id>.jsonl
 *  or under ~/.claude/projects/<enc>/<sessionId>/subagents/agent-<id>.jsonl.
 *  Returns { input, output, cacheRead, cacheWrite, total } or null if not found. */
function subagentTokenUsage(cwd, agentId, env) {
  const home = env.HOME || env.USERPROFILE || "";
  if (!home) return null;
  const enc = cwd.replace(/[/.]/g, "-");
  const base = join(home, ".claude", "projects", enc);
  if (!existsSync(base)) return null;
  const file = `agent-${agentId}.jsonl`;
  const candidates = [join(base, file)];
  try {
    for (const entry of readdirSync(base)) {
      const sub = join(base, entry, "subagents", file);
      if (existsSync(sub)) candidates.push(sub);
    }
  } catch { /* base not a dir / unreadable — fall through */ }
  const path = candidates.find((p) => existsSync(p));
  if (!path) return null;

  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
  for (const line of readFileSync(path, "utf8").trim().split("\n")) {
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    const u = rec?.message?.usage;
    if (!u) continue;
    input += u.input_tokens ?? 0;
    output += u.output_tokens ?? 0;
    cacheRead += u.cache_read_input_tokens ?? 0;
    cacheWrite += u.cache_creation_input_tokens ?? 0;
  }
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

/** Read the hook JSON payload Claude Code pipes to stdin. Returns null if not piped (TTY) or invalid. */
function readHookStdin() {
  if (process.stdin.isTTY) return null; // manual invocation — don't block on stdin
  try {
    const raw = readFileSync(0, "utf8"); // fd 0 = stdin
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

/** Install a PostToolUse hook in global ~/.claude/settings.json so the session log updates
 *  in real time. PostToolUse fires after EVERY tool call — Stop only fires once per turn, which
 *  in an autonomous loop (one long turn of many tool calls) almost never fires mid-loop. */
function installSessionLogHook(env, log) {
  const home = env.HOME || env.USERPROFILE || "";
  if (!home) { log("autoloop: cannot install session-log hook — HOME not set"); return; }
  const settingsPath = join(home, ".claude", "settings.json");
  let settings = {};
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, "utf8")); } catch { settings = {}; }
  }
  // Copy the current CLI to a STABLE, version-independent path so the hook command
  // doesn't break when the plugin updates (plugin paths are version-pinned). The skill
  // re-runs `init --session-log` each loop, refreshing this copy to the current version.
  mkdirSync(join(home, ".claude"), { recursive: true });
  const stableCli = join(home, ".claude", "autoloop-cli.mjs");
  try { copyFileSync(process.argv[1], stableCli); }
  catch (e) { log(`autoloop: could not copy CLI to stable path: ${e.message}`); return; }

  if (!settings.hooks) settings.hooks = {};
  // session push reads the loop from .autoloop.json and the transcript path from the hook stdin payload.
  // It auto-detects main vs subagent (SubagentStop payload carries agent_transcript_path).
  const hookCmd = `node "${stableCli}" session push`;

  // Remove any prior autoloop session-push hook (from Stop/PostToolUse/SubagentStop, possibly stale path).
  for (const ev of ["Stop", "PostToolUse", "SubagentStop"]) {
    if (Array.isArray(settings.hooks[ev])) {
      settings.hooks[ev] = settings.hooks[ev].filter((h) => !h.hooks?.some((hh) => hh.command?.includes("session push")));
    }
  }
  // PostToolUse → main-session activity (orchestration), real-time per tool call.
  settings.hooks.PostToolUse = settings.hooks.PostToolUse ?? [];
  settings.hooks.PostToolUse.push({ matcher: "*", hooks: [{ type: "command", command: hookCmd }] });
  // SubagentStop → each subagent's full transcript when it finishes (the actual implementation work).
  settings.hooks.SubagentStop = settings.hooks.SubagentStop ?? [];
  settings.hooks.SubagentStop.push({ hooks: [{ type: "command", command: hookCmd }] });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  log(`autoloop: real-time session-log hooks (PostToolUse + SubagentStop) installed → ${settingsPath} (CLI: ${stableCli})`);
}

// ── Phase 2: relaunch machinery ─────────────────────────────────────────────
// New home for host-side state: ~/.autoloop/{autoloop-cli.mjs, run/, logs/}.
// Deliberate divergence from the session-log hook's ~/.claude/autoloop-cli.mjs
// stable copy — that one stays where it is and converges later.

export function autoloopHome(env) {
  const home = env.HOME || env.USERPROFILE || "";
  if (!home) throw new UsageError("HOME not set");
  return join(home, ".autoloop");
}
export function lockPath(env, teamId, slug) { return join(autoloopHome(env), "run", `${teamId}-${slug}.lock`); }

export function readLock(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } // corrupt ⇒ treat as absent
}

/** Liveness = kill -0. */
export function defaultIsAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

/** ps lookup for the ancestor walk: pid → { ppid, comm } | null. */
export function defaultPsLookup(pid) {
  try {
    const out = execFileSync("ps", ["-o", "ppid=,comm=", "-p", String(pid)], { encoding: "utf8" }).trim();
    const m = out.match(/^\s*(\d+)\s+(.*)$/);
    return m ? { ppid: Number(m[1]), comm: m[2] } : null;
  } catch { return null; }
}

/**
 * Walk our own ancestor chain (via ps -o ppid=) to the nearest `claude` process — the
 * Claude Code SESSION pid, not this short-lived CLI child. found:false ⇒ pid is the
 * direct parent (caller warns; --pid overrides for hook shims that have session context).
 */
export function findClaudeSessionPid(startPid, psLookup) {
  const parent = psLookup(startPid)?.ppid ?? null;
  let pid = parent;
  for (let hops = 0; pid && pid > 1 && hops < 20; hops++) {
    const info = psLookup(pid);
    if (!info) break;
    if (basename(info.comm || "") === "claude") return { pid, found: true };
    pid = info.ppid;
  }
  return { pid: parent, found: false };
}

/** Classify a lockfile: "none" | "dead" (steal) | "ours" (this session) | "live-other". */
export function evaluateLock(lock, isAlive, selfSessionPid) {
  if (!lock || typeof lock.pid !== "number") return "none";
  if (!isAlive(lock.pid)) return "dead";
  if (selfSessionPid !== null && lock.pid === selfSessionPid) return "ours";
  return "live-other";
}

export const RELAUNCH_MAX = 3;                       // > 3 relaunches in 30 min ⇒ stop (crash loop)
export const RELAUNCH_WINDOW_MS = 30 * 60 * 1000;

export function stampsPath(env, key) { return join(autoloopHome(env), "run", `${key}.stamps.json`); }
export function readStamps(path) {
  if (!existsSync(path)) return [];
  try { const v = JSON.parse(readFileSync(path, "utf8")); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** true ⇒ STOP relaunching: RELAUNCH_MAX stamps already inside the rolling window
 *  (the relaunch being considered would be the >3rd within 30 minutes). */
export function backoffExceeded(stamps, nowMs, max = RELAUNCH_MAX, windowMs = RELAUNCH_WINDOW_MS) {
  return (stamps ?? []).filter((t) => nowMs - t < windowMs).length >= max;
}

/** Pure decision for the SessionEnd shim. "ours" may proceed — that session is ending anyway. */
export function decideSessionEndRelaunch({ lockState, resumable, backoff }) {
  if (lockState === "live-other") return { relaunch: false, reason: "another live session holds the lock" };
  if (!resumable) return { relaunch: false, reason: "no non-terminal, non-paused loop (loop resume --check failed)" };
  if (backoff) return { relaunch: false, reason: `backoff: more than ${RELAUNCH_MAX} relaunches in 30 minutes` };
  return { relaunch: true, reason: "resumable loop, no live lock, under backoff" };
}

/** Pure decision for the wake job: paused loop + pending message + no live lock. */
export function decideWake({ lockState, loopStatus, hasPendingMessages }) {
  if (lockState === "live-other" || lockState === "ours") return { wake: false, reason: "a live session holds the lock" };
  if (loopStatus !== "paused") return { wake: false, reason: `loop status is ${loopStatus ?? "none"} — wake only resumes paused loops` };
  if (!hasPendingMessages) return { wake: false, reason: "no pending user messages" };
  return { wake: true, reason: "paused loop with pending messages and no live lock" };
}

/** Launch the headless driver, fully detached (nohup-equivalent): stdin /dev/null, output
 *  appended to ~/.autoloop/logs/<slug>.log, detached + unref so the parent can exit.
 *  acceptEdits + the installed permissions.allow list — NEVER --dangerously-skip-permissions. */
export function launchHeadless({ cwd, slug, env, spawnImpl, log }) {
  const logDir = join(autoloopHome(env), "logs");
  mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, `${slug}.log`);
  const out = openSync(logFile, "a");
  // launchd/cron parents carry a bare env: spawn the absolute claude path (CLAUDE_BIN from
  // ~/.autoloop/env) and pass the API key through so the session's own autoloop calls work.
  const childEnv = { ...process.env };
  for (const k of ["AUTOLOOP_API_KEY", "AUTOLOOP_API_URL"]) {
    if (env[k] && !childEnv[k]) childEnv[k] = env[k];
  }
  if (env.CLAUDE_BIN) childEnv.PATH = `${dirname(env.CLAUDE_BIN)}${childEnv.PATH ? ":" + childEnv.PATH : ""}`;
  const child = spawnImpl(env.CLAUDE_BIN || "claude", ["-p", "/autoloop", "--permission-mode", "acceptEdits"],
    { cwd, detached: true, stdio: ["ignore", out, out], env: childEnv });
  child.unref?.();
  log(`autoloop: relaunched headless driver (pid ${child.pid ?? "?"}) — log: ${logFile}`);
}

/** Append one line to ~/.autoloop/logs/hooks.log — diagnosable, never fails the hook. */
export function hookLog(env, tag, msg, nowMs = Date.now()) {
  try {
    mkdirSync(join(autoloopHome(env), "logs"), { recursive: true });
    writeFileSync(join(autoloopHome(env), "logs", "hooks.log"),
      `[${new Date(nowMs).toISOString()}] ${tag}: ${msg}\n`, { flag: "a" });
  } catch { /* never fail the hook over logging */ }
}

/** Parse KEY=VALUE lines (the ~/.autoloop/env file). Ignores blank lines and #-comments;
 *  values may contain '='. Pure. */
export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text).split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    out[t.slice(0, i)] = t.slice(i + 1);
  }
  return out;
}

/** Merge ~/.autoloop/env into env — REAL env always wins; file fills the gaps.
 *  launchd/cron jobs inherit no shell env, so the hooks load this before any API call.
 *  Never throws. */
export function loadAutoloopEnv(env) {
  try {
    const p = join(autoloopHome(env), "env");
    if (!existsSync(p)) return env;
    const fileVals = parseEnvFile(readFileSync(p, "utf8"));
    const merged = { ...env };
    for (const [k, v] of Object.entries(fileVals)) {
      if (merged[k] === undefined || merged[k] === "") merged[k] = v;
    }
    return merged;
  } catch { return env; }
}

const RELAUNCH_HOOK_MARKER = "hook session-end";
export const BASE_ALLOW = ["Bash(autoloop:*)", "Bash(git:*)"];

/** Marker files in the project root → permission allowlist for the headless run. Pure.
 *  acceptEdits alone cannot run Bash; in headless mode anything outside the allowlist is
 *  denied and logged (never prompted) — the user EXTENDS this list rather than the
 *  installer going permission-less. --dangerously-skip-permissions is deliberately not used. */
export function detectAllowlist(filesPresent) {
  const f = new Set(filesPresent);
  const out = [...BASE_ALLOW];
  if (f.has("package.json")) out.push("Bash(npm:*)", "Bash(npx:*)", "Bash(node:*)");
  if (f.has("pnpm-lock.yaml")) out.push("Bash(pnpm:*)");
  if (f.has("yarn.lock")) out.push("Bash(yarn:*)");
  if (f.has("Makefile")) out.push("Bash(make:*)");
  if (f.has("Cargo.toml")) out.push("Bash(cargo:*)");
  if (f.has("go.mod")) out.push("Bash(go:*)");
  if (f.has("pyproject.toml") || f.has("requirements.txt")) out.push("Bash(python:*)", "Bash(pytest:*)", "Bash(uv:*)");
  return out;
}

/** launchd plist for the 5-min wake job. WorkingDirectory is baked in — launchd has no cwd. */
export function wakePlist({ label, nodePath, stableCli, projDir, logPath }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${stableCli}</string>
    <string>hook</string>
    <string>wake</string>
  </array>
  <key>WorkingDirectory</key><string>${projDir}</string>
  <key>StartInterval</key><integer>300</integer>
  <key>StandardOutPath</key><string>${logPath}</string>
  <key>StandardErrorPath</key><string>${logPath}</string>
</dict>
</plist>
`;
}

/** Install (or uninstall) the relaunch machinery: stable CLI copy under ~/.autoloop/,
 *  SessionEnd hook + permissions.allow in the PROJECT .claude/settings.json (project-level,
 *  unlike the session-log hook's global install — the shim needs the project cwd), and the
 *  launchd wake job. Idempotent: prior autoloop entries are filtered before re-adding
 *  (the installSessionLogHook versioned pattern). */
function installRelaunch(projDir, env, { log, err, execImpl, platform, uninstall = false }) {
  const cfg = loadConfig(projDir); // requires an initialized project — teamId/slug name the lock + plist
  const home = autoloopHome(env);
  const stableCli = join(home, "autoloop-cli.mjs");
  const settingsPath = join(projDir, ".claude", "settings.json");
  const plistPath = join(env.HOME || env.USERPROFILE || "", "Library", "LaunchAgents", `com.autoloop.wake.${cfg.projectSlug}.plist`);

  let settings = {};
  if (existsSync(settingsPath)) { try { settings = JSON.parse(readFileSync(settingsPath, "utf8")); } catch { settings = {}; } }
  settings.hooks = settings.hooks ?? {};
  settings.permissions = settings.permissions ?? {};
  settings.permissions.allow = settings.permissions.allow ?? [];
  settings.hooks.SessionEnd = (settings.hooks.SessionEnd ?? [])
    .filter((h) => !h.hooks?.some((hh) => hh.command?.includes(RELAUNCH_HOOK_MARKER)));

  if (uninstall) {
    const added = cfg.relaunch?.allowAdded ?? [];
    settings.permissions.allow = settings.permissions.allow.filter((a) => !added.includes(a));
    mkdirSync(join(projDir, ".claude"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    if (existsSync(plistPath)) {
      try { execImpl("launchctl", ["unload", plistPath]); } catch { /* not loaded */ }
      rmSync(plistPath);
    }
    const lockFile = lockPath(env, cfg.teamId, cfg.projectSlug);
    if (existsSync(lockFile)) rmSync(lockFile);
    const envFile = join(home, "env"); // holds the API key — remove on uninstall
    if (existsSync(envFile)) rmSync(envFile);
    delete cfg.relaunch;
    saveConfig(projDir, cfg);
    log("autoloop: relaunch machinery uninstalled (SessionEnd hook, added allowlist entries, wake job, lock, env file)");
    return 0;
  }

  // 1. ~/.autoloop home + a stable, version-independent CLI copy (refreshed on every install)
  mkdirSync(join(home, "run"), { recursive: true });
  mkdirSync(join(home, "logs"), { recursive: true });
  try { copyFileSync(process.argv[1], stableCli); }
  catch (e) { err(`autoloop: could not copy CLI to ${stableCli}: ${e.message}`); return 1; }

  // 1b. ~/.autoloop/env — launchd/cron jobs inherit no shell env; the hook shims load
  //     this file (real env wins). 0600: it holds the API key.
  const envFile = join(home, "env");
  const claudeBin = (() => {
    try { const p = String(execImpl("which", ["claude"])).trim(); return p || null; } catch { return null; }
  })();
  const envLines = [];
  if (env.AUTOLOOP_API_KEY) envLines.push(`AUTOLOOP_API_KEY=${env.AUTOLOOP_API_KEY}`);
  else err("autoloop: AUTOLOOP_API_KEY is not set — the wake job cannot reach the API until you add it to " + envFile);
  if (env.AUTOLOOP_API_URL) envLines.push(`AUTOLOOP_API_URL=${env.AUTOLOOP_API_URL}`);
  if (claudeBin) envLines.push(`CLAUDE_BIN=${claudeBin}`);
  else err("autoloop: `claude` not found on PATH — relaunches will fail until you add CLAUDE_BIN to " + envFile);
  writeFileSync(envFile, envLines.join("\n") + "\n", { mode: 0o600 });
  chmodSync(envFile, 0o600); // writeFileSync mode applies only on create — enforce on refresh too

  // 2. SessionEnd hook (NOT Stop — Stop fires once per turn while the session is alive and
  //    would spawn a competing driver; SessionEnd fires only on actual termination).
  settings.hooks.SessionEnd.push({ hooks: [{ type: "command", command: `node "${stableCli}" hook session-end` }] });

  // 3. permissions.allow for the headless `claude -p "/autoloop" --permission-mode acceptEdits`
  let files; try { files = readdirSync(projDir); } catch { files = []; }
  const wanted = detectAllowlist(files);
  const added = wanted.filter((a) => !settings.permissions.allow.includes(a));
  settings.permissions.allow.push(...added);
  mkdirSync(join(projDir, ".claude"), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");

  // 4. wake job: launchd on macOS; documented crontab line elsewhere
  const logPath = join(home, "logs", `${cfg.projectSlug}.wake.log`);
  if (platform === "darwin") {
    mkdirSync(join(env.HOME || env.USERPROFILE || "", "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(plistPath, wakePlist({ label: `com.autoloop.wake.${cfg.projectSlug}`, nodePath: process.execPath, stableCli, projDir, logPath }));
    try { execImpl("launchctl", ["unload", plistPath]); } catch { /* not loaded yet */ }
    try { execImpl("launchctl", ["load", plistPath]); log(`autoloop: wake job loaded (every 5 min) → ${plistPath}`); }
    catch (e) { err(`autoloop: wrote ${plistPath} but launchctl load failed: ${e.message} — load it manually`); }
  } else {
    log(`autoloop: non-macOS host — install the wake job with this crontab line:\n*/5 * * * * cd ${projDir} && ${process.execPath} ${stableCli} hook wake >> ${logPath} 2>&1`);
  }

  // 5. marker: `autoloop status` reports relaunchInstalled; --uninstall removes ONLY allowAdded
  const prevAdded = cfg.relaunch?.allowAdded ?? [];
  cfg.relaunch = { installedAt: new Date().toISOString(), allowAdded: [...new Set([...prevAdded, ...added])] };
  saveConfig(projDir, cfg);
  log(`autoloop: relaunch machinery installed (SessionEnd hook + allowlist → ${settingsPath}; CLI: ${stableCli})`);
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
    psLookup = defaultPsLookup,
    isAlive = defaultIsAlive,
    spawnImpl = spawn,
    execImpl = execFileSync,
    platform = process.platform,
    now = Date.now,
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
    const ONE_WORD = new Set(["init", "commit", "score", "test-run", "revise", "verify"]);
    const dispatchKey = ONE_WORD.has(cmd) ? cmd : `${cmd} ${sub ?? ""}`.trim();
    switch (dispatchKey) {
      case "init": {
        // `autoloop init --relaunch [--uninstall]` manages host-side relaunch machinery for an
        // ALREADY-initialized project — no --team needed (mirrors the init --session-log /
        // `session-log` pair).
        if (flags.relaunch && !flags.team) {
          return installRelaunch(cwd, env, { log, err, execImpl, platform, uninstall: !!flags.uninstall });
        }
        const teamId = flags.team, projectSlug = flags.project;
        if (!teamId || !projectSlug) throw new UsageError("init requires --team <teamId> --project <slug>");
        validateId("teamId", teamId);
        validateId("projectSlug", projectSlug);
        const apiUrl = (typeof flags.url === "string" && flags.url) || DEFAULT_API_URL;
        saveConfig(cwd, { apiUrl, teamId, projectSlug, currentLoopId: null, loops: {}, currentPhaseId: null, currentTaskId: null, phases: {}, tasks: {} });
        log(`autoloop: initialized .autoloop.json (team=${teamId}, project=${projectSlug})`);
        if (flags["session-log"]) installSessionLogHook(env, log);
        if (flags.relaunch) return installRelaunch(cwd, env, { log, err, execImpl, platform, uninstall: !!flags.uninstall });
        return 0;
      }
      case "init --session-log":
      case "session-log": {
        installSessionLogHook(env, log);
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
        const body = {};
        if (flags.status) {
          validateStatus(flags.status);
          body.status = flags.status;
        }
        if (flags["preview-url"] !== undefined) {
          const v = oneFlag("preview-url", flags["preview-url"]);
          if (typeof v !== "string") throw new UsageError('--preview-url requires a value (use "" to clear)');
          body.previewUrl = v === "" ? null : v; // empty string clears (stored as null)
        }
        if (Object.keys(body).length === 0) throw new UsageError("loop set requires at least one of --status/--preview-url");
        const cfg = loadConfig(cwd);
        if (flags.status && TERMINAL_STATUSES.includes(flags.status)) {
          cfg.currentLoopId = null;
          saveConfig(cwd, cfg);
        }
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/loops/${loopId}`;
        return report({ method: "PUT", url, body },
          { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "loop resume": {
        const cfg = loadConfig(cwd);
        const explicit = positionals[2];
        if (explicit) validateId("loopId", explicit);
        const fetched = await fetchResumeState(cfg, env, fetchImpl, { loopId: explicit, urlFlag: flags.url });
        if (flags.check) {
          // --check: the EXIT CODE is the contract — 0 iff a non-terminal, non-paused loop
          // exists; silent so hook shims can branch on it. Any failure ⇒ 1.
          return fetched && isResumable(fetched.state) ? 0 : 1;
        }
        // plain resume is best-effort and ALWAYS exits 0 (exit code only means something with --check)
        if (!fetched) { err("autoloop: loop resume failed (network or HTTP error)"); return 0; }
        const { state } = fetched;
        if (!state.loop || TERMINAL_STATUSES.includes(state.loop.status)) err("autoloop: no active loop");
        log(resumeHeader(state));
        log(JSON.stringify(state, null, 2));
        return 0;
      }
      case "lock acquire": {
        const cfg = loadConfig(cwd);
        let pid;
        if (flags.pid !== undefined) {
          pid = Number(flags.pid);
          if (!Number.isInteger(pid) || pid <= 0) throw new UsageError(`--pid must be a positive integer, got '${flags.pid}'`);
        } else {
          const found = findClaudeSessionPid(process.pid, psLookup);
          if (!found.pid) throw new UsageError("could not determine a session pid — pass --pid <n>");
          if (!found.found) err("autoloop: no `claude` ancestor found — recording the direct parent pid (pass --pid to override)");
          pid = found.pid;
        }
        const path = lockPath(env, cfg.teamId, cfg.projectSlug);
        const state = evaluateLock(readLock(path), isAlive, pid);
        if (state === "live-other") { err(`autoloop: lock held by live pid ${readLock(path).pid} — not acquiring`); return 1; }
        if (state === "dead") err(`autoloop: stealing stale lock (recorded pid is dead)`);
        mkdirSync(join(autoloopHome(env), "run"), { recursive: true });
        writeFileSync(path, JSON.stringify({ pid, acquiredAt: new Date(now()).toISOString() }) + "\n");
        log(`autoloop: lock acquired (pid ${pid}) → ${path}`);
        return 0;
      }
      case "lock release": {
        const cfg = loadConfig(cwd);
        const path = lockPath(env, cfg.teamId, cfg.projectSlug);
        if (existsSync(path)) { rmSync(path); log(`autoloop: lock released → ${path}`); }
        else log("autoloop: no lock to release");
        return 0;
      }
      case "hook session-end": {
        // SessionEnd shim — fires when the Claude Code session actually TERMINATES.
        // (Deliberately NOT Stop: Stop fires at the end of every turn while the session is
        // still alive — wiring it would spawn a competing driver against a live session.)
        // Best-effort: ALWAYS exit 0; a failing hook must never break Claude Code.
        // launchd/cron-launched shims inherit no shell env — fill the gaps from ~/.autoloop/env.
        const henv = loadAutoloopEnv(env);
        const hook = readHookStdin();                  // { session_id, cwd, ... }
        const projDir = hook?.cwd || cwd;
        let cfg;
        try { cfg = loadConfig(projDir); } catch (e) { hookLog(henv, "session-end", `skip: ${e.message}`, now()); return 0; }
        const key = `${cfg.teamId}-${cfg.projectSlug}`;
        const lockFile = lockPath(henv, cfg.teamId, cfg.projectSlug);
        // "ours" = the lock pid is THIS ending session's claude ancestor — it may hand off.
        const self = findClaudeSessionPid(process.pid, psLookup);
        const lockState = evaluateLock(readLock(lockFile), isAlive, self.pid ?? null);

        const stamps = readStamps(stampsPath(henv, key)).filter((t) => now() - t < RELAUNCH_WINDOW_MS);
        const backoff = backoffExceeded(stamps, now());
        // resumable? — the same probe as `loop resume --check`, in-process
        const fetched = await fetchResumeState(cfg, henv, fetchImpl);
        const resumable = !!fetched && isResumable(fetched.state);

        const d = decideSessionEndRelaunch({ lockState, resumable, backoff });
        hookLog(henv, "session-end", `lock=${lockState} resumable=${resumable} backoff=${backoff} → ${d.relaunch ? "RELAUNCH" : "skip"} (${d.reason})`, now());
        if (!d.relaunch) return 0;

        if (existsSync(lockFile)) rmSync(lockFile);    // release: this session is gone; the relaunch re-acquires
        mkdirSync(join(autoloopHome(henv), "run"), { recursive: true });
        writeFileSync(stampsPath(henv, key), JSON.stringify([...stamps, now()]));
        launchHeadless({ cwd: projDir, slug: cfg.projectSlug, env: henv, spawnImpl, log });
        return 0;
      }
      case "hook wake": {
        // launchd interval shim (every 5 min; WorkingDirectory = project dir, baked into the
        // plist because launchd jobs have no cwd context). Linux runs the same verb from cron.
        // launchd/cron jobs inherit no shell env — fill the gaps from ~/.autoloop/env.
        const henv = loadAutoloopEnv(env);
        let cfg;
        try { cfg = loadConfig(cwd); } catch (e) { hookLog(henv, "wake", `skip: ${e.message}`, now()); return 0; }
        const lockFile = lockPath(henv, cfg.teamId, cfg.projectSlug);
        const lockState = evaluateLock(readLock(lockFile), isAlive, null); // no claude ancestor under launchd

        const fetched = await fetchResumeState(cfg, henv, fetchImpl);     // `loop resume` JSON
        const loopStatus = fetched?.state?.loop?.status;
        // pending messages — same probe as `messages pull --check`, in-process (GET only, never acks)
        const api = resolveApiUrl(cfg, henv, undefined);
        const msgs = await getJson(`${api}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/messages`, { env: henv, fetchImpl });
        const hasPendingMessages = !!(msgs?.ok && Array.isArray(msgs.body?.messages) && msgs.body.messages.length > 0);

        const d = decideWake({ lockState, loopStatus, hasPendingMessages });
        hookLog(henv, "wake", `lock=${lockState} loop=${loopStatus ?? "none"} pending=${hasPendingMessages} → ${d.wake ? "WAKE" : "skip"} (${d.reason})`, now());
        if (!d.wake) return 0;
        if (lockState === "dead") rmSync(lockFile);    // steal the stale lock; the new session re-acquires
        launchHeadless({ cwd, slug: cfg.projectSlug, env: henv, spawnImpl, log });
        return 0;
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
          try { content = readFileSync(assertSafePath(cwd, flags.file, "file"), "utf8"); }
          catch (e) { if (e instanceof UsageError) throw e; throw new UsageError(`could not read --file '${flags.file}': ${e.message}`); }
          format = "markdown";
        } else { format = "url"; content = flags.url; }
        if (flags.format) {
          if (!["markdown", "url", "json"].includes(flags.format)) {
            throw new UsageError(`--format must be markdown|url|json, got '${flags.format}'`);
          }
          format = flags.format;
        }
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
      case "idea add": {
        const id = positionals[2]; validateId("ideaId", id);
        if (typeof flags.title !== "string") throw new UsageError("idea add requires --title <t>");
        const status = flags.status || "proposed";
        if (!["proposed", "accepted", "rejected", "done"].includes(status)) throw new UsageError(`--status must be proposed|accepted|rejected|done, got '${status}'`);
        const order = typeof flags.order === "string" ? Number(flags.order) : 100;
        if (!Number.isInteger(order)) throw new UsageError(`--order must be an integer, got '${flags.order}'`);
        const body = { title: flags.title, status, order };
        if (typeof flags["rationale-file"] === "string") {
          try { body.rationale = readFileSync(assertSafePath(cwd, flags["rationale-file"], "rationale-file"), "utf8"); }
          catch (e) { if (e instanceof UsageError) throw e; throw new UsageError(`could not read --rationale-file '${flags["rationale-file"]}': ${e.message}`); }
        } else if (typeof flags.rationale === "string") {
          body.rationale = flags.rationale;
        }
        if (flags["origin-loop"]) { validateId("origin-loop", flags["origin-loop"]); body.originLoopId = flags["origin-loop"]; }
        const cfg = loadConfig(cwd);
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/ideas/${id}`;
        return report({ method: "PUT", url, body },
          { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "idea set": {
        const id = positionals[2]; validateId("ideaId", id);
        const body = {};
        if (flags.status) {
          if (!["proposed", "accepted", "rejected", "done"].includes(flags.status)) throw new UsageError(`--status must be proposed|accepted|rejected|done, got '${flags.status}'`);
          body.status = flags.status;
        }
        if (typeof flags.title === "string") body.title = flags.title;
        if (typeof flags.order === "string") {
          const order = Number(flags.order);
          if (!Number.isInteger(order)) throw new UsageError(`--order must be an integer, got '${flags.order}'`);
          body.order = order;
        }
        if (typeof flags.rationale === "string") body.rationale = flags.rationale;
        if (flags["origin-loop"]) { validateId("origin-loop", flags["origin-loop"]); body.originLoopId = flags["origin-loop"]; }
        if (flags["built-in-loop"]) { validateId("built-in-loop", flags["built-in-loop"]); body.builtInLoopId = flags["built-in-loop"]; }
        if (Object.keys(body).length === 0) throw new UsageError("idea set requires at least one of --status/--title/--order/--rationale/--origin-loop/--built-in-loop");
        const cfg = loadConfig(cwd);
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/ideas/${id}`;
        return report({ method: "PUT", url, body },
          { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "idea list": {
        const cfg = loadConfig(cwd);
        const api = resolveApiUrl(cfg, env, flags.url);
        const url = `${api}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/ideas`;
        return fetchJson({ method: "GET", url }, {
          env, fetchImpl, log, err, label: "idea list",
          render: (b) => (b.ideas ?? []).map((i) => `[${i.status}] ${i.order} ${i.id} — ${i.title}`).join("\n") || "(no ideas)",
        });
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
        const commitBody = { message: c.message, author: c.author, committedAt: c.committedAt };
        // Attribute the implementing subagent's token usage to this commit (Agent tool returns
        // the agentId to the loop driver, which passes it here as --agent <agentId>).
        if (flags.agent) {
          const tokens = subagentTokenUsage(cwd, String(flags.agent), env);
          if (tokens) commitBody.tokens = tokens;
          else err(`autoloop: no subagent transcript found for agent '${flags.agent}' — commit recorded without tokens`);
        }
        const url = `${apiBase}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}${loopSeg(cfg)}/tasks/${taskId}/commits/${c.sha}`;
        return report({ method: "PUT", url, body: commitBody },
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
          try { body.summary = readFileSync(assertSafePath(cwd, flags["summary-file"], "summary-file"), "utf8"); }
          catch (e) { if (e instanceof UsageError) throw e; throw new UsageError(`could not read --summary-file '${flags["summary-file"]}': ${e.message}`); }
        } else if (flags.summary) {
          body.summary = flags.summary;
        }
        const cfg = loadConfig(cwd);
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}${loopSeg(cfg)}/testRuns`;
        return report({ method: "POST", url, body }, { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "verify": {
        oneFlag("test-run", flags["test-run"]); oneFlag("verdict", flags.verdict);
        const scenarioId = positionals[1]; validateId("scenarioId", scenarioId);
        if (typeof flags["test-run"] !== "string") throw new UsageError("verify requires --test-run <testRunId>");
        if (!["confirmed", "refuted"].includes(flags.verdict)) throw new UsageError(`--verdict must be confirmed|refuted, got '${flags.verdict}'`);
        // testRunId is a server ULID (uppercase) — deliberately NOT validateId'd.
        const body = { scenarioId, testRunId: String(flags["test-run"]), verdict: flags.verdict };
        if (flags.task) { validateId("task", flags.task); body.taskId = flags.task; }
        if (flags["summary-file"]) {
          try { body.summary = readFileSync(assertSafePath(cwd, flags["summary-file"], "summary-file"), "utf8"); }
          catch (e) { if (e instanceof UsageError) throw e; throw new UsageError(`could not read --summary-file '${flags["summary-file"]}': ${e.message}`); }
        } else if (flags.summary) {
          body.summary = flags.summary;
        }
        const cfg = loadConfig(cwd);
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}${loopSeg(cfg)}/verifications`;
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
        try { vision = JSON.parse(readFileSync(assertSafePath(cwd, flags.file, "file"), "utf8")); }
        catch (e) { if (e instanceof UsageError) throw e; throw new UsageError(`could not read --file '${flags.file}': ${e.message}`); }
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
          // `test` and `governance` are loop-local (how /autoloop tests + governs the
          // scenario), not part of the server contract — strip them client-side so the
          // import body never carries them.
          const { id, test, governance, ...body } = s;
          worst = Math.max(worst, await report({ method: "PUT", url: `${proj}/scenarios/${id}`, body }, reportDeps));
        }
        for (const d of vision.documents ?? []) {
          validateId("docId", d.id);
          const { id, ...body } = d;
          worst = Math.max(worst, await report({ method: "PUT", url: `${proj}/documents/${id}`, body }, reportDeps));
        }
        return worst; // best-effort: 0 unless strict and some report failed
      }
      case "vision propose": {
        oneFlag("op", flags.op); oneFlag("target", flags.target); oneFlag("file", flags.file); oneFlag("reason", flags.reason);
        if ([flags.op, flags.target, flags.file, flags.reason].some((v) => typeof v !== "string")) {
          throw new UsageError("vision propose requires --op <upsert-goal|upsert-scenario> --target <id> --file <payload.json> --reason <text>");
        }
        if (!["upsert-goal", "upsert-scenario"].includes(flags.op)) {
          throw new UsageError(`--op must be upsert-goal|upsert-scenario, got '${flags.op}'`);
        }
        validateId("target", flags.target);
        let payload;
        try { payload = JSON.parse(readFileSync(join(cwd, flags.file), "utf8")); }
        catch (e) { throw new UsageError(`could not read --file '${flags.file}': ${e.message}`); }
        const body = { op: flags.op, targetId: flags.target, payload, reason: flags.reason };
        if (flags["origin-loop"]) { validateId("origin-loop", flags["origin-loop"]); body.originLoopId = flags["origin-loop"]; }
        const cfg = loadConfig(cwd);
        // Project-level on purpose (no loopSeg): vision changes are project vision, never loop-scoped.
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/vision-changes`;
        return report({ method: "POST", url, body },
          { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "messages pull": {
        const cfg = loadConfig(cwd);
        const api = resolveApiUrl(cfg, env, flags.url);
        const url = `${api}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/messages`;
        if (flags.check) {
          // silent probe for the wake shim: exit 0 iff pending user messages exist.
          // GET only — pulling NEVER acks; any failure ⇒ 1 (can't confirm pending).
          const res = await getJson(url, { env, fetchImpl });
          return res?.ok && Array.isArray(res.body?.messages) && res.body.messages.length > 0 ? 0 : 1;
        }
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
      case "status": {
        // Minimal status report — the relaunch marker is what the driver skill branches on.
        const cfg = loadConfig(cwd);
        log(JSON.stringify({
          teamId: cfg.teamId,
          projectSlug: cfg.projectSlug,
          currentLoopId: cfg.currentLoopId ?? null,
          relaunchInstalled: !!cfg.relaunch,
        }, null, 2));
        return 0;
      }
      case "session push": {
        // Debug log — every hook firing appends here so failures are diagnosable.
        // Inspect with:  cat ~/.claude/autoloop-session.log
        const dbg = (m) => {
          try {
            const home = env.HOME || env.USERPROFILE || "";
            if (home) writeFileSync(join(home, ".claude", "autoloop-session.log"),
              `[${new Date().toISOString()}] ${m}\n`, { flag: "a" });
          } catch { /* never fail the hook over logging */ }
        };
        dbg(`session push invoked (argv: ${argv.join(" ")})`);

        // Hook payloads on stdin:
        //   PostToolUse  → { session_id, transcript_path, cwd, tool_name, ... }   (main session)
        //   SubagentStop → { session_id, transcript_path, cwd, agent_id, agent_transcript_path, ... }
        // A subagent event carries agent_transcript_path — we read THAT transcript but still append
        // to the MAIN session's doc (session_id) so it merges into one timeline.
        const hook = readHookStdin();
        const isSubagent = !!hook?.agent_transcript_path;
        dbg(`stdin payload: ${hook ? JSON.stringify({ session_id: hook.session_id, subagent: isSubagent, agent_id: hook.agent_id, transcript: hook.agent_transcript_path || hook.transcript_path, cwd: hook.cwd }) : "none (TTY or empty)"}`);
        const transcriptPath = flags.file || (isSubagent ? hook.agent_transcript_path : hook?.transcript_path);
        if (!transcriptPath) {
          dbg("ABORT: no transcript_path");
          err("autoloop: session push skipped — no transcript_path (not run as a hook? pass --file)");
          return 0;
        }
        if (!existsSync(transcriptPath)) {
          dbg(`ABORT: transcript not found at ${transcriptPath}`);
          err(`autoloop: session transcript not found at ${transcriptPath}`);
          return 0; // best-effort: don't fail the hook
        }

        let cfg;
        try { cfg = loadConfig(hook?.cwd || cwd); }
        catch (e) { dbg(`ABORT: loadConfig failed (cwd=${hook?.cwd || cwd}): ${e.message}`); err(`autoloop: ${e.message}`); return 0; }
        const loopId = flags.loop || cfg.currentLoopId;
        if (!loopId) { dbg("ABORT: no active loop in .autoloop.json"); err("autoloop: session push skipped — no active loop"); return 0; }
        validateId("loopId", loopId);
        dbg(`config ok: team=${cfg.teamId} project=${cfg.projectSlug} loop=${loopId} apiKey=${env.AUTOLOOP_API_KEY ? "set" : "MISSING"}`);

        // The DOC we append to is keyed by the MAIN session id (merges subagent work in).
        const sessionId = flags.session || hook?.session_id || basename(transcriptPath, ".jsonl");
        // The CURSOR is per-transcript-file: a subagent has its own high-water mark (keyed by agent_id).
        const cursorKey = flags.session ? sessionId : (isSubagent ? `${hook.session_id}:${hook.agent_id}` : (hook?.session_id || basename(transcriptPath, ".jsonl")));
        const allLines = readFileSync(transcriptPath, "utf8").trim().split("\n").filter(Boolean);

        // DELTA: only parse + send transcript lines we haven't sent yet. The cursor (line
        // count already uploaded, per cursorKey) lives in ~/.claude/autoloop-cursors.json.
        const home = env.HOME || env.USERPROFILE || "";
        const cursorPath = home ? join(home, ".claude", "autoloop-cursors.json") : null;
        let cursors = {};
        if (cursorPath && existsSync(cursorPath)) {
          try { cursors = JSON.parse(readFileSync(cursorPath, "utf8")); } catch { cursors = {}; }
        }
        const sent = Number(cursors[cursorKey] || 0);
        if (allLines.length <= sent) {
          dbg(`no new transcript lines (have ${allLines.length}, already sent ${sent}) — skip`);
          return 0; // nothing new — don't hit the API at all
        }
        const lines = allLines.slice(sent); // only the new lines
        const entries = [];
        // Maps tool_use id → index in entries array so tool_result can patch ok=false (within this delta).
        const toolIndexById = new Map();
        let startedAt = null, endedAt = null;

        for (const line of lines) {
          let rec; try { rec = JSON.parse(line); } catch { continue; }
          const rawTs = rec.timestamp ?? rec.ts ?? null;
          const ts = typeof rawTs === "string" ? Date.parse(rawTs) : (typeof rawTs === "number" ? rawTs : null);
          if (ts && !isNaN(ts)) { if (!startedAt || ts < startedAt) startedAt = ts; if (!endedAt || ts > endedAt) endedAt = ts; }
          const role = rec.type === "user" ? "user" : rec.type === "assistant" ? "assistant" : null;
          if (!role) continue;
          const msg = rec.message ?? rec;
          const content = Array.isArray(msg.content) ? msg.content : [];
          for (const block of content) {
            if (block.type === "text" && block.text) {
              entries.push({ kind: role, text: String(block.text).slice(0, 500), ts: ts ?? 0 });
            }
            if (role === "assistant" && block.type === "tool_use") {
              const inputSummary = JSON.stringify(block.input ?? {}).slice(0, 120);
              toolIndexById.set(block.id, entries.length);
              entries.push({ kind: "tool", name: block.name ?? "tool", summary: inputSummary, ok: true, ts: ts ?? 0 });
            }
            // tool_result arrives in a subsequent user record — patch the matched tool entry's ok flag
            if (role === "user" && block.type === "tool_result" && block.tool_use_id) {
              const idx = toolIndexById.get(block.tool_use_id);
              if (idx !== undefined && block.is_error) entries[idx].ok = false;
            }
          }
        }

        if (entries.length === 0) {
          // New lines existed but produced no displayable entries (e.g. system records).
          // Advance the cursor anyway so we don't re-scan them next time.
          if (cursorPath) { cursors[cursorKey] = allLines.length; try { writeFileSync(cursorPath, JSON.stringify(cursors)); } catch { /* best-effort */ } }
          dbg(`no new entries from ${lines.length} new lines — cursor advanced to ${allLines.length}`);
          return 0;
        }

        const body = { sessionId, startedAt: startedAt ?? 0, endedAt: endedAt ?? 0, entries };
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/loops/${loopId}/sessions`;
        dbg(`POST ${url} — ${entries.length} new entries (lines ${sent}..${allLines.length}), session=${sessionId}`);
        // strict:true so `code` reflects a GENUINE 200 (network blips / 4xx → 1). We use that only
        // to decide cursor advancement — a failed push keeps the cursor so the same delta retries.
        const code = await report({ method: "POST", url, body }, { env, fetchImpl, err, strict: true, teamId: cfg.teamId });
        dbg(`POST result: ${code === 0 ? "success (200)" : "failed — cursor not advanced, will retry"}`);
        if (code === 0 && cursorPath) {
          cursors[cursorKey] = allLines.length;
          try { writeFileSync(cursorPath, JSON.stringify(cursors)); } catch { /* best-effort */ }
        }
        return 0; // always exit 0 from the hook — never surface a transient push failure to the user
      }
      case "run-log append": {
        // LOCAL-ONLY (no network): append one JSONL entry per loop iteration to
        // .autoloop-runlog.jsonl — the on-disk spine for budget/convergence checks.
        // Mirrors loop-engineering's loop-budget run-log. outcome is a closed enum.
        const OUTCOMES = ["no-op", "reported", "met", "rejected", "escalated"];
        if (!OUTCOMES.includes(flags.outcome)) throw new UsageError(`run-log append requires --outcome one of: ${OUTCOMES.join("|")}`);
        const entry = { run_id: new Date(now()).toISOString(), outcome: flags.outcome };
        if (flags.scenario) { validateId("scenario", flags.scenario); entry.scenario = flags.scenario; }
        if (flags.task) { validateId("task", flags.task); entry.task = flags.task; }
        const numFlag = (name, key) => {
          if (flags[name] === undefined) return;
          const n = Number(flags[name]);
          if (!Number.isFinite(n)) throw new UsageError(`--${name} must be a number, got '${flags[name]}'`);
          entry[key] = n;
        };
        numFlag("tokens", "tokens_estimate");
        numFlag("duration", "duration_s");
        numFlag("actions", "actions_taken");
        numFlag("escalations", "escalations");
        if (typeof flags.note === "string") entry.note = flags.note;
        const path = join(cwd, ".autoloop-runlog.jsonl");
        try { writeFileSync(path, JSON.stringify(entry) + "\n", { flag: "a" }); }
        catch (e) { throw new UsageError(`could not append to ${path}: ${e.message}`); }
        log(`run-log: ${entry.outcome}${entry.scenario ? ` ${entry.scenario}` : ""}${entry.tokens_estimate !== undefined ? ` (~${entry.tokens_estimate} tok)` : ""}`);
        return 0;
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
// realpathSync resolves symlinks so the guard matches when the CLI is invoked via a
// symlinked path (e.g. a stable ~/.claude copy on a system where ~/.claude is symlinked).
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    if (import.meta.url === pathToFileURL(process.argv[1]).href) return true;
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch { return false; }
}
if (isMainModule()) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => { console.error(`autoloop: unexpected error: ${e.message}`); process.exit(1); });
}
