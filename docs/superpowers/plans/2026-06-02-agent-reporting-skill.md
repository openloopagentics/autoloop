# Agent Reporting CLI & Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dependency-free Node CLI (`cli/autoloop.mjs`) plus a Claude Code skill that lets an agent report project/phase/commit status to the deployed Autoloop API as it runs a dev loop in another repo.

**Architecture:** One self-contained ESM script exposing a testable `run(argv, deps)` (deps inject `fetchImpl` and `gitRun` so unit tests need no network or real git; the shebang entry just calls `run` and `process.exit`s its return code). Commands map to the team-scoped REST endpoints; config is a non-secret `.autoloop.json` + `AUTOLOOP_API_KEY` in env. Reporting failures are best-effort (warn + exit 0); usage errors fail loud (exit 1, pre-network).

**Tech Stack:** Node 22 (global `fetch`, `node:child_process`, `node:fs`) — no npm deps, no build. Tested with the repo's existing Vitest + Firestore-emulator harness.

**Reference spec:** `docs/superpowers/specs/2026-06-02-agent-reporting-skill-design.md`
**Builds on the deployed API:** `PUT /v1/teams/{teamId}/projects/{slug}[/phases/{phaseId}[/commits/{sha}]]`, per-user key auth (`Authorization: Bearer al_…`; unknown→401, non-member→403, missing parent→404, validation→400). Status enum: `queued|running|blocked|paused|completed|failed|cancelled`. id pattern `^[a-z0-9._-]+$`. Keys resolve by `sha256(full plaintext)`.

---

## Background / conventions

- The CLI lives at repo-root `cli/autoloop.mjs` (separate from the API in `functions/`). It's runnable as `node cli/autoloop.mjs <command> …` with no install.
- **Tests live in `functions/test/`** so they reuse the existing emulator harness (`functions/test/helpers.ts` sets `FIRESTORE_EMULATOR_HOST`, clears Firestore each test) and Vitest. They import the CLI as `../../cli/autoloop.mjs`. Vitest runs `.ts` tests via esbuild (no type-check), so importing the untyped `.mjs` is fine at runtime; `npm run build` (tsc, `include: ["src"]`) never compiles `cli/` or `test/`, so there's no type-check breakage.
- **Testability seam:** `run(argv, { cwd, env, fetchImpl, gitRun })` returns an exit code (number). Tests call it in-process, injecting a fake `fetchImpl` (captures request / returns canned responses) and `gitRun` (returns canned `git log` output). The integration test injects the real `fetch` pointed at a locally-booted `makeApp()`.
- **Exit codes:** `0` success; `1` usage error (bad args / missing config / missing key / invalid status or id / phase-not-started / commit guards) — thrown as `UsageError` BEFORE any network call; reporting failures (HTTP 4xx/5xx, network) print a one-line stderr warning and return `0` by default, or `1` when `--strict` (or `AUTOLOOP_STRICT=1`).
- Run a single CLI test file with `npm run test:run -- cli` (start `npm run emulators` in the background first only for the integration test).

## File structure

| File | Responsibility |
|---|---|
| `cli/autoloop.mjs` | the whole CLI: arg parsing, config I/O, validation, git read, request layer, command dispatch, `run()` + entry guard |
| `functions/test/cli.unit.test.ts` | unit tests for the pure pieces (parse/config/validate/git/request-build/exit-policy) via injected deps |
| `functions/test/cli.integration.test.ts` | end-to-end: boot `makeApp()` on a port + emulator, seed key+membership, drive `run()` |
| `skills/autoloop-reporting/SKILL.md` | Claude Code skill: when to report |
| `skills/autoloop-reporting/CODEX.md` | same CLI commands for Codex-driven loops |

`cli/autoloop.mjs` is built up across Tasks 1–6 (each adds a piece and stays runnable). Tasks 7–8 add the integration test and the skill docs.

---

## Task 1: CLI skeleton — parse, validate, config, dispatch

**Files:** Create `cli/autoloop.mjs`; Test `functions/test/cli.unit.test.ts`

- [ ] **Step 1: Write the failing test** (`functions/test/cli.unit.test.ts`)

```typescript
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// @ts-ignore - untyped .mjs imported for runtime test
import { parseArgs, validateStatus, validateId, loadConfig, saveConfig, run } from "../../cli/autoloop.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "autoloop-")); }

describe("parseArgs", () => {
  it("splits positionals and --flags (with values and booleans)", () => {
    const { positionals, flags } = parseArgs(["phase", "start", "p1", "--name", "Build", "--order", "1", "--strict"]);
    expect(positionals).toEqual(["phase", "start", "p1"]);
    expect(flags.name).toBe("Build");
    expect(flags.order).toBe("1");
    expect(flags.strict).toBe(true);
  });
});

describe("validateStatus / validateId", () => {
  it("accepts valid, rejects invalid", () => {
    expect(() => validateStatus("running")).not.toThrow();
    expect(() => validateStatus("nope")).toThrow();
    expect(() => validateId("teamId", "acme-1")).not.toThrow();
    expect(() => validateId("teamId", "Bad Id")).toThrow();
  });
});

describe("config I/O", () => {
  it("saves and loads .autoloop.json; loadConfig throws when missing", () => {
    const dir = tmp();
    expect(() => loadConfig(dir)).toThrow(/init/);
    saveConfig(dir, { apiUrl: "u", teamId: "t", projectSlug: "p", currentPhaseId: null, phases: {} });
    expect(loadConfig(dir).teamId).toBe("t");
    expect(JSON.parse(readFileSync(join(dir, ".autoloop.json"), "utf8")).projectSlug).toBe("p");
  });
});

describe("run dispatch", () => {
  it("returns 1 and a message for an unknown command", async () => {
    const errs: string[] = [];
    const code = await run(["bogus"], { cwd: tmp(), env: {}, log: () => {}, err: (m: string) => errs.push(m) });
    expect(code).toBe(1);
    expect(errs.join(" ")).toMatch(/unknown command/i);
  });
});
```

- [ ] **Step 2: Run RED** — `npm run test:run -- cli.unit` → FAIL (no module).

- [ ] **Step 3: Implement the skeleton** `cli/autoloop.mjs`

```javascript
#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const STATUSES = ["queued", "running", "blocked", "paused", "completed", "failed", "cancelled"];
const ID_RE = /^[a-z0-9._-]+$/;
const CONFIG_FILE = ".autoloop.json";
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
  if (!existsSync(p)) throw new UsageError("not initialized — run `autoloop init`");
  return JSON.parse(readFileSync(p, "utf8"));
}
export function saveConfig(cwd, cfg) {
  writeFileSync(join(cwd, CONFIG_FILE), JSON.stringify(cfg, null, 2) + "\n");
}

/**
 * Run an autoloop command. Returns an exit code (0 ok, 1 usage error).
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
    if (e instanceof UsageError) { err(`autoloop: ${e.message}`); return 1; }
    throw e;
  }
}

// Entry point (only when run directly, not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
```

> Note: the test passes `log`/`err` collectors; `run`'s signature already accepts them. Keep the `default: throw UsageError` so the dispatch test passes; real command cases are added in Tasks 2–6.

- [ ] **Step 4: Run GREEN** — `npm run test:run -- cli.unit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/autoloop.mjs functions/test/cli.unit.test.ts
git commit -m "feat(cli): autoloop skeleton - parse/validate/config/dispatch"
```

---

## Task 2: `init` command

**Files:** Modify `cli/autoloop.mjs`; Modify `functions/test/cli.unit.test.ts`

- [ ] **Step 1: Append the failing test**

```typescript
describe("init", () => {
  it("writes .autoloop.json with team/project/url and empty phase state", async () => {
    const dir = tmp();
    const code = await run(["init", "--team", "acme", "--project", "web", "--url", "http://x"], { cwd: dir, env: {}, log: () => {}, err: () => {} });
    expect(code).toBe(0);
    const cfg = loadConfig(dir);
    expect(cfg).toMatchObject({ apiUrl: "http://x", teamId: "acme", projectSlug: "web", currentPhaseId: null, phases: {} });
  });

  it("defaults apiUrl when --url omitted, and validates ids", async () => {
    const dir = tmp();
    await run(["init", "--team", "acme", "--project", "web"], { cwd: dir, env: {}, log: () => {}, err: () => {} });
    expect(loadConfig(dir).apiUrl).toBeTruthy();
    const errs: string[] = [];
    const code = await run(["init", "--team", "Bad Team", "--project", "web"], { cwd: tmp(), env: {}, log: () => {}, err: (m: string) => errs.push(m) });
    expect(code).toBe(1);
    expect(errs.join(" ")).toMatch(/invalid teamId/);
  });
});
```

- [ ] **Step 2: Run RED** — `npm run test:run -- cli.unit` → the init tests FAIL.

- [ ] **Step 3: Add the `init` case** to the `switch` in `run`

```javascript
      case "init": {
        const teamId = flags.team, projectSlug = flags.project;
        if (!teamId || !projectSlug) throw new UsageError("init requires --team <teamId> --project <slug>");
        validateId("teamId", teamId);
        validateId("projectSlug", projectSlug);
        const apiUrl = (typeof flags.url === "string" && flags.url) || DEFAULT_API_URL;
        saveConfig(cwd, { apiUrl, teamId, projectSlug, currentPhaseId: null, phases: {} });
        log(`autoloop: initialized .autoloop.json (team=${teamId}, project=${projectSlug})`);
        return 0;
      }
```

(Note: `init` is matched by `cmd` alone; since `sub` is undefined, the switch key is `"init"`.)

- [ ] **Step 4: Run GREEN** — `npm run test:run -- cli.unit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/autoloop.mjs functions/test/cli.unit.test.ts
git commit -m "feat(cli): init command writes .autoloop.json"
```

---

## Task 3: Request layer + exit-code policy

**Files:** Modify `cli/autoloop.mjs`; Modify `functions/test/cli.unit.test.ts`

Adds the shared helper that resolves the URL/key, sends one request via the injected `fetchImpl`, and applies the best-effort exit policy. No command uses it yet (Task 4+); test it directly via a tiny exported `report()`.

- [ ] **Step 1: Append the failing test**

```typescript
// @ts-ignore
import { report, resolveApiUrl } from "../../cli/autoloop.mjs";

describe("resolveApiUrl precedence", () => {
  it("flag > env > config", () => {
    expect(resolveApiUrl({ apiUrl: "c" }, { AUTOLOOP_API_URL: "e" }, "f")).toBe("f");
    expect(resolveApiUrl({ apiUrl: "c" }, { AUTOLOOP_API_URL: "e" }, undefined)).toBe("e");
    expect(resolveApiUrl({ apiUrl: "c" }, {}, undefined)).toBe("c");
  });
});

describe("report (exit policy)", () => {
  const okFetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }), text: async () => "" });
  function failFetch(status: number, body: any) {
    return async () => ({ ok: false, status, json: async () => body, text: async () => JSON.stringify(body) });
  }
  const base = { cwd: "/", env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {} };

  it("throws UsageError when AUTOLOOP_API_KEY missing (before network)", async () => {
    await expect(report({ method: "PUT", url: "http://x/v1", body: {} }, { ...base, env: {} })).rejects.toThrow(/AUTOLOOP_API_KEY/);
  });

  it("returns 0 on success and sends Bearer auth + JSON body", async () => {
    let captured: any;
    const code = await report({ method: "PUT", url: "http://x/v1/teams/t/projects/p", body: { title: "x" } },
      { ...base, fetchImpl: async (url: string, init: any) => { captured = { url, init }; return okFetch(); } });
    expect(code).toBe(0);
    expect(captured.init.method).toBe("PUT");
    expect(captured.init.headers.Authorization).toBe("Bearer al_k");
    expect(JSON.parse(captured.init.body).title).toBe("x");
  });

  it("warns + returns 0 on a 403 by default; returns 1 with strict", async () => {
    const errs: string[] = [];
    const d = { ...base, err: (m: string) => errs.push(m), fetchImpl: failFetch(403, { error: { code: "forbidden", message: "no" } }) };
    expect(await report({ method: "PUT", url: "http://x", body: {} }, d)).toBe(0);
    expect(errs.join(" ")).toMatch(/not a member/i);
    expect(await report({ method: "PUT", url: "http://x", body: {} }, { ...d, strict: true })).toBe(1);
  });
});
```

- [ ] **Step 2: Run RED** — FAIL.

- [ ] **Step 3: Implement `resolveApiUrl` and `report`** in `cli/autoloop.mjs`

```javascript
export function resolveApiUrl(cfg, env, flagUrl) {
  return (typeof flagUrl === "string" && flagUrl) || env.AUTOLOOP_API_URL || cfg.apiUrl;
}

const REPORT_MESSAGES = {
  401: "invalid or expired AUTOLOOP_API_KEY",
  403: (teamId) => `your API key's user is not a member of team ${teamId ?? "(unknown)"}`,
  404: "team/project/phase not found — run `autoloop project set` first",
};

/**
 * Send one report request. deps: { env, fetchImpl, err, strict, teamId }.
 * Returns 0 on success; on failure prints a one-line warning and returns 0,
 * or 1 when strict. Throws UsageError (caught by run -> exit 1) for a missing key.
 */
export async function report(req, deps) {
  const { env, fetchImpl = fetch, err = (m) => console.error(m), strict = false, teamId } = deps;
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

  if (res.ok) return 0;

  let detail = "";
  if (res.status === 400) {
    try { detail = (await res.json())?.error?.message ?? ""; } catch { /* ignore */ }
  }
  const m = REPORT_MESSAGES[res.status];
  const msg = typeof m === "function" ? m(teamId) : (m ?? `HTTP ${res.status}`);
  err(`autoloop: report not applied (${res.status}): ${msg}${detail ? ` — ${detail}` : ""}`);
  return strict ? 1 : 0;
}
```

- [ ] **Step 4: Run GREEN** — PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/autoloop.mjs functions/test/cli.unit.test.ts
git commit -m "feat(cli): request layer with best-effort exit policy"
```

---

## Task 4: `project set` command

**Files:** Modify `cli/autoloop.mjs`; Modify `functions/test/cli.unit.test.ts`

- [ ] **Step 1: Append the failing test** (drives the command via injected fetch; asserts URL + body)

```typescript
describe("project set", () => {
  function initDir() {
    const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentPhaseId: null, phases: {} });
    return dir;
  }
  it("PUTs the project with title/status/design-file", async () => {
    const dir = initDir();
    writeFileSync(join(dir, "plan.md"), "# Plan");
    let captured: any;
    const code = await run(["project", "set", "--title", "Web", "--status", "running", "--design-file", "plan.md"],
      { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {},
        fetchImpl: async (url: string, init: any) => { captured = { url, init }; return { ok: true, status: 200, json: async () => ({}) }; } });
    expect(code).toBe(0);
    expect(captured.url).toBe("http://api/v1/teams/acme/projects/web");
    const body = JSON.parse(captured.init.body);
    expect(body).toMatchObject({ title: "Web", status: "running", design: { format: "markdown", content: "# Plan" } });
  });
  it("rejects an invalid status (exit 1, no network)", async () => {
    const errs: string[] = [];
    const code = await run(["project", "set", "--title", "Web", "--status", "nope"],
      { cwd: initDir(), env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: (m: string) => errs.push(m),
        fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).toBe(1);
    expect(errs.join(" ")).toMatch(/invalid status/);
  });
});
```

- [ ] **Step 2: Run RED** — FAIL.

- [ ] **Step 3: Add the `project set` case**

```javascript
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
        return report({ method: "PUT", url, body }, { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
```

- [ ] **Step 4: Run GREEN** — PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/autoloop.mjs functions/test/cli.unit.test.ts
git commit -m "feat(cli): project set command"
```

---

## Task 5: `phase start` and `phase set`

**Files:** Modify `cli/autoloop.mjs`; Modify `functions/test/cli.unit.test.ts`

`phase start` creates/records the phase; `phase set` re-sends the recorded name/order plus status (valid create-or-update) and guards against an unstarted id.

- [ ] **Step 1: Append the failing test**

```typescript
describe("phase start/set", () => {
  function initDir() {
    const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentPhaseId: null, phases: {} });
    return dir;
  }
  const okFetch = async (url: string, init: any) => { (okFetch as any).last = { url, init }; return { ok: true, status: 200, json: async () => ({}) }; };

  it("phase start records name/order + currentPhaseId and PUTs running", async () => {
    const dir = initDir();
    const code = await run(["phase", "start", "build", "--name", "Build", "--order", "1"],
      { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: okFetch });
    expect(code).toBe(0);
    expect((okFetch as any).last.url).toBe("http://api/v1/teams/acme/projects/web/phases/build");
    expect(JSON.parse((okFetch as any).last.init.body)).toMatchObject({ name: "Build", order: 1, status: "running" });
    const cfg = loadConfig(dir);
    expect(cfg.currentPhaseId).toBe("build");
    expect(cfg.phases.build).toEqual({ name: "Build", order: 1 });
  });

  it("phase set re-sends recorded name/order + new status", async () => {
    const dir = initDir();
    await run(["phase", "start", "build", "--name", "Build", "--order", "1"], { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: okFetch });
    await run(["phase", "set", "build", "--status", "completed"], { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: okFetch });
    expect(JSON.parse((okFetch as any).last.init.body)).toMatchObject({ name: "Build", order: 1, status: "completed" });
  });

  it("phase set on an unstarted id -> exit 1, no network", async () => {
    const errs: string[] = [];
    const code = await run(["phase", "set", "ghost", "--status", "completed"],
      { cwd: initDir(), env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: (m: string) => errs.push(m), fetchImpl: async () => { throw new Error("no"); } });
    expect(code).toBe(1);
    expect(errs.join(" ")).toMatch(/not started/);
  });
});
```

- [ ] **Step 2: Run RED** — FAIL.

- [ ] **Step 3: Add the `phase start` / `phase set` cases**

```javascript
      case "phase start": {
        const phaseId = positionals[2];
        validateId("phaseId", phaseId);
        if (!flags.name || typeof flags.order !== "string") throw new UsageError("phase start requires --name <n> --order <number>");
        const order = Number(flags.order);
        if (!Number.isInteger(order)) throw new UsageError(`--order must be an integer, got '${flags.order}'`);
        const status = flags.status || "running";
        validateStatus(status);
        const cfg = loadConfig(cwd);
        cfg.phases = cfg.phases || {};
        cfg.phases[phaseId] = { name: flags.name, order };
        cfg.currentPhaseId = phaseId;
        saveConfig(cwd, cfg);
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/phases/${phaseId}`;
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
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/phases/${phaseId}`;
        return report({ method: "PUT", url, body: { name: rec.name, order: rec.order, status: flags.status } },
          { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
```

- [ ] **Step 4: Run GREEN** — PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/autoloop.mjs functions/test/cli.unit.test.ts
git commit -m "feat(cli): phase start/set with config-tracked name/order"
```

---

## Task 6: `commit` command (git HEAD + guards)

**Files:** Modify `cli/autoloop.mjs`; Modify `functions/test/cli.unit.test.ts`

`autoloop commit` reads git HEAD via an injectable `gitRun` (default executes `git log -1 --format=%H%n%cI%n%an%n%s`), parses it, guards locally, and PUTs the commit under `currentPhaseId`.

- [ ] **Step 1: Append the failing test**

```typescript
// @ts-ignore
import { parseGitHead } from "../../cli/autoloop.mjs";

describe("parseGitHead", () => {
  it("parses sha / ISO committedAt / author / message", () => {
    const out = "deadbeef\n2026-06-02T01:25:49-07:00\nAlice\nfix: thing";
    expect(parseGitHead(out)).toEqual({ sha: "deadbeef", committedAt: "2026-06-02T01:25:49-07:00", author: "Alice", message: "fix: thing" });
  });
});

describe("commit", () => {
  function initDir() {
    const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentPhaseId: "build", phases: { build: { name: "Build", order: 1 } } });
    return dir;
  }
  const gitRun = () => "deadbeef\n2026-06-02T01:25:49-07:00\nAlice\nfix: thing";

  it("PUTs the commit under currentPhaseId with git fields", async () => {
    const dir = initDir();
    let captured: any;
    const code = await run(["commit"], { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, gitRun,
      fetchImpl: async (url: string, init: any) => { captured = { url, init }; return { ok: true, status: 200, json: async () => ({}) }; } });
    expect(code).toBe(0);
    expect(captured.url).toBe("http://api/v1/teams/acme/projects/web/phases/build/commits/deadbeef");
    expect(JSON.parse(captured.init.body)).toMatchObject({ message: "fix: thing", author: "Alice", committedAt: "2026-06-02T01:25:49-07:00" });
  });

  it("exits 1 when no currentPhaseId", async () => {
    const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentPhaseId: null, phases: {} });
    const errs: string[] = [];
    const code = await run(["commit"], { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: (m: string) => errs.push(m), gitRun, fetchImpl: async () => { throw new Error("no"); } });
    expect(code).toBe(1);
    expect(errs.join(" ")).toMatch(/no current phase/i);
  });

  it("exits 1 when git author is empty", async () => {
    const errs: string[] = [];
    const code = await run(["commit"], { cwd: initDir(), env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: (m: string) => errs.push(m),
      gitRun: () => "deadbeef\n2026-06-02T01:25:49-07:00\n\nfix: thing", fetchImpl: async () => { throw new Error("no"); } });
    expect(code).toBe(1);
    expect(errs.join(" ")).toMatch(/author/);
  });
});
```

- [ ] **Step 2: Run RED** — FAIL.

- [ ] **Step 3: Implement `parseGitHead`, a default `gitRun`, and the `commit` case**

Add near the top imports:
```javascript
import { execFileSync } from "node:child_process";
```
Helpers + case:
```javascript
export function parseGitHead(out) {
  const [sha = "", committedAt = "", author = "", ...rest] = out.split("\n");
  return { sha, committedAt, author, message: rest.join("\n") };
}

function defaultGitRun(cwd) {
  return execFileSync("git", ["log", "-1", "--format=%H%n%cI%n%an%n%s"], { cwd, encoding: "utf8" }).trim();
}
```
In the `switch`:
```javascript
      case "commit": {
        const cfg = loadConfig(cwd);
        if (!cfg.currentPhaseId) throw new UsageError("no current phase — run `autoloop phase start` first");
        let raw;
        try { raw = (gitRun ? gitRun(cwd) : defaultGitRun(cwd)).trim(); }
        catch (e) { throw new UsageError(`could not read git HEAD (is this a git repo with commits?): ${e.message}`); }
        const c = parseGitHead(raw);
        validateId("sha", c.sha);
        if (!c.author) throw new UsageError("git author empty — set `git config user.name`");
        if (!c.message) throw new UsageError("git commit message empty");
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/phases/${cfg.currentPhaseId}/commits/${c.sha}`;
        return report({ method: "PUT", url, body: { message: c.message, author: c.author, committedAt: c.committedAt } },
          { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
```
Also thread `gitRun` from `run`'s deps (already destructured in Task 1's skeleton — confirm `gitRun` is in the deps destructure; if not, add it).

- [ ] **Step 4: Run GREEN** — `npm run test:run -- cli.unit` → all PASS. Also confirm `autoloop commit` works against a real repo manually is optional.

- [ ] **Step 5: Commit**

```bash
git add cli/autoloop.mjs functions/test/cli.unit.test.ts
git commit -m "feat(cli): commit command reads git HEAD with strict-ISO date"
```

---

## Task 7: End-to-end integration test (real API + emulator)

**Files:** Create `functions/test/cli.integration.test.ts`

Boots the real Express app on a port, points the CLI at it, seeds a key + membership, and drives the full flow.

> **Emulator:** start `npm run emulators` in a background shell on 8080, then `npm run test:run -- cli.integration`. (Or run the full `npm test`, which self-launches.)

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Server } from "node:http";
import "./helpers.js";
import { db } from "../src/firestore.js";
import { makeApp } from "../src/app.js";
// @ts-ignore
import { run } from "../../cli/autoloop.mjs";

const PLAINTEXT = "al_integrationkey";
const KEY_HASH = createHash("sha256").update(PLAINTEXT).digest("hex");
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => { server = makeApp().listen(0, resolve); });
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(() => { server?.close(); });

async function seedKeyAndMember(teamId: string, uid = "agentX") {
  await db().doc(`apiKeys/${KEY_HASH}`).set({ uid, label: "it", prefix: "al_integ" });
  await db().doc(`teams/${teamId}`).set({ name: "T", createdBy: uid });
  await db().doc(`teams/${teamId}/members/${uid}`).set({ uid, role: "member" });
}

function dir() { return mkdtempSync(join(tmpdir(), "autoloop-it-")); }
const env = { AUTOLOOP_API_KEY: PLAINTEXT };

describe("CLI end-to-end against the real API", () => {
  it("init -> project set -> phase start -> commit lands in Firestore", async () => {
    await seedKeyAndMember("itteam");
    const cwd = dir();
    const opts = { cwd, env, log: () => {}, err: () => {},
      gitRun: () => "abc123\n2026-06-02T10:00:00Z\nAgent\nfeat: x" };

    expect(await run(["init", "--team", "itteam", "--project", "web", "--url", baseUrl], opts)).toBe(0);
    expect(await run(["project", "set", "--title", "Web", "--status", "running"], opts)).toBe(0);
    expect(await run(["phase", "start", "build", "--name", "Build", "--order", "1"], opts)).toBe(0);
    expect(await run(["commit"], opts)).toBe(0);

    const project = (await db().doc("teams/itteam/projects/web").get()).data()!;
    expect(project.title).toBe("Web");
    expect(project.currentPhaseId).toBe("build");
    const commit = (await db().doc("teams/itteam/projects/web/phases/build/commits/abc123").get()).data()!;
    expect(commit.message).toBe("feat: x");
    expect(commit.author).toBe("Agent");
  });

  it("a bad key warns and returns 0 (best-effort); strict returns 1", async () => {
    const cwd = dir();
    const opts = { cwd, env: { AUTOLOOP_API_KEY: "al_wrong" }, log: () => {}, err: () => {} };
    await run(["init", "--team", "itteam", "--project", "web", "--url", baseUrl], opts);
    expect(await run(["project", "set", "--title", "x", "--status", "running"], opts)).toBe(0);
    expect(await run(["project", "set", "--title", "x", "--status", "running", "--strict"], opts)).toBe(1);
  });

  it("a non-member key -> 403 warning, returns 0", async () => {
    // The global beforeEach (helpers.ts) wipes Firestore before each test, so re-seed
    // the key here — but with NO membership in 'lonelyteam' so it reaches 403 (not 401).
    await db().doc(`apiKeys/${KEY_HASH}`).set({ uid: "agentX", label: "it", prefix: "al_integ" });
    await db().doc("teams/lonelyteam").set({ name: "L", createdBy: "someoneelse" });
    const cwd = dir();
    const opts = { cwd, env, log: () => {}, err: () => {} };
    await run(["init", "--team", "lonelyteam", "--project", "web", "--url", baseUrl], opts);
    expect(await run(["project", "set", "--title", "x", "--status", "running"], opts)).toBe(0); // best-effort
    expect(await run(["project", "set", "--title", "x", "--status", "running", "--strict"], opts)).toBe(1);
  });
});
```

- [ ] **Step 2: Run** — `npm run test:run -- cli.integration` (emulator running) → PASS. Then full `npm test` → all green.

- [ ] **Step 3: Commit**

```bash
git add functions/test/cli.integration.test.ts
git commit -m "test(cli): end-to-end against the real API + emulator"
```

---

## Task 8: The skill docs (SKILL.md + Codex note)

**Files:** Create `skills/autoloop-reporting/SKILL.md`, `skills/autoloop-reporting/CODEX.md`

- [ ] **Step 1: Write `skills/autoloop-reporting/SKILL.md`**

Frontmatter + body. Must include:
- `name: autoloop-reporting` and a `description` that triggers when an agent is running an Autoloop dev loop and should report status.
- **Prerequisites:** `AUTOLOOP_API_KEY` set in env (a key minted via `POST /v1/keys`); run `node <path>/cli/autoloop.mjs init --team <id> --project <slug>` once.
- **Lifecycle mapping** (the table from the spec): project start → `init` + `project set --title --status running --design-file <plan>`; entering a phase → `phase start <id> --name --order`; after each commit → `commit`; leaving a phase → `phase set <id> --status completed|failed`; loop end → `project set --status …`.
- **Core principle:** reporting is best-effort observability — a `autoloop` warning never blocks the loop; do not treat its output as fatal. (`--strict` exists but is opt-in.)
- The status enum and that ids must be `^[a-z0-9._-]+$`.

- [ ] **Step 2: Write `skills/autoloop-reporting/CODEX.md`** — the same command list and lifecycle, framed as plain instructions for a Codex-driven loop (no Claude-skill frontmatter), pointing at the same `cli/autoloop.mjs`.

- [ ] **Step 3: Sanity-check the CLI runs standalone**

Run: `node cli/autoloop.mjs init --team demo --project demo --url http://localhost:9 && cat .autoloop.json && rm .autoloop.json` (in a scratch dir)
Expected: writes/echoes the config (no network for `init`). Clean up the scratch `.autoloop.json`.

- [ ] **Step 4: Commit**

```bash
git add skills/autoloop-reporting/SKILL.md skills/autoloop-reporting/CODEX.md
git commit -m "docs: add autoloop-reporting skill + Codex usage note"
```

---

## Task 9: README — agent reporting section

**Files:** Modify `README.md`

- [ ] **Step 1:** Add a short "Reporting from an agent loop" section: the CLI path, `AUTOLOOP_API_KEY` (minted via `POST /v1/keys`), `autoloop init`, and the lifecycle commands; link to `skills/autoloop-reporting/`.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document agent reporting CLI in README"
```

---

## Done criteria

- `npm test` (full suite incl. CLI unit + integration) and `npm run test:rules` pass; `npm run build` clean (unchanged — `cli/` is outside the tsc `src` root).
- `node cli/autoloop.mjs` runs the five commands; reporting failures warn and exit 0 (exit 1 under `--strict`); usage errors exit 1 before any network call.
- Integration test proves an `init → project set → phase start → commit` flow lands in Firestore through the real app, and that bad-key/non-member paths are best-effort by default.
- The `autoloop-reporting` skill + Codex note document when to call which command, emphasizing best-effort reporting.
