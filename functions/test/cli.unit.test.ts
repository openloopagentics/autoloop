import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
// @ts-ignore - untyped .mjs imported for runtime test
import { parseArgs, validateStatus, validateId, loadConfig, saveConfig, run, firstNonTerminalTask, isResumable, findClaudeSessionPid, evaluateLock, backoffExceeded, decideSessionEndRelaunch, decideWake, detectAllowlist, wakePlist, parseEnvFile, loadAutoloopEnv, stopFingerprint, decideStop, STOP_IDLE_MAX } from "../../cli/autoloop.mjs";

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

// @ts-ignore
import { report, resolveApiUrl, fetchWithRetry } from "../../cli/autoloop.mjs";

describe("resolveApiUrl precedence", () => {
  it("flag > env > config", () => {
    expect(resolveApiUrl({ apiUrl: "c" }, { AUTOLOOP_API_URL: "e" }, "f")).toBe("f");
    expect(resolveApiUrl({ apiUrl: "c" }, { AUTOLOOP_API_URL: "e" }, undefined)).toBe("e");
    expect(resolveApiUrl({ apiUrl: "c" }, {}, undefined)).toBe("c");
  });
});

describe("fetchWithRetry (timeout + transient retry)", () => {
  const noSleep = async () => {}; // skip real backoff in tests
  const resp = (status: number) => ({ ok: status < 400, status, json: async () => ({}) });

  it("returns the first success without retrying", async () => {
    let calls = 0;
    const res: any = await fetchWithRetry("u", { method: "PUT" },
      { fetchImpl: async () => { calls++; return resp(200); }, sleep: noSleep });
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("retries a network error on an idempotent method, then succeeds", async () => {
    let calls = 0;
    const res: any = await fetchWithRetry("u", { method: "PUT" }, {
      sleep: noSleep,
      fetchImpl: async () => { calls++; if (calls < 3) throw new Error("ECONNRESET"); return resp(200); },
    });
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
  });

  it("retries HTTP 5xx then returns the last response when retries are exhausted", async () => {
    let calls = 0;
    const res: any = await fetchWithRetry("u", { method: "PUT" },
      { sleep: noSleep, fetchImpl: async () => { calls++; return resp(503); } });
    expect(res.status).toBe(503);
    expect(calls).toBe(3); // initial + 2 retries
  });

  it("does NOT retry a 4xx", async () => {
    let calls = 0;
    const res: any = await fetchWithRetry("u", { method: "PUT" },
      { sleep: noSleep, fetchImpl: async () => { calls++; return resp(400); } });
    expect(res.status).toBe(400);
    expect(calls).toBe(1);
  });

  it("does NOT retry a network error on a non-idempotent POST", async () => {
    let calls = 0;
    await expect(fetchWithRetry("u", { method: "POST" },
      { sleep: noSleep, fetchImpl: async () => { calls++; throw new Error("net"); } }))
      .rejects.toThrow(/net/);
    expect(calls).toBe(1);
  });

  it("retries a 429 even on a non-idempotent POST (server never processed it)", async () => {
    let calls = 0;
    const res: any = await fetchWithRetry("u", { method: "POST" },
      { sleep: noSleep, fetchImpl: async () => { calls++; return resp(429); } });
    expect(res.status).toBe(429);
    expect(calls).toBe(3);
  });

  it("aborts a hung request via the per-attempt timeout", async () => {
    let signalled = false;
    await expect(fetchWithRetry("u", { method: "PUT" }, {
      sleep: noSleep, attempts: 1, timeoutMs: 5,
      fetchImpl: (_u: string, init: any) => new Promise((_res, rej) => {
        init.signal.addEventListener("abort", () => { signalled = true; rej(new Error("aborted")); });
      }),
    })).rejects.toThrow();
    expect(signalled).toBe(true);
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

describe("phase start/set", () => {
  function initDir() {
    const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentPhaseId: null, phases: {} });
    return dir;
  }
  const okFetch = async (url: string, init: any) => { (okFetch as any).last = { url, init }; return { ok: true, status: 200, json: async () => ({}) }; };

  it("phase start records name/order + currentPhaseId and PUTs queued", async () => {
    const dir = initDir();
    const code = await run(["phase", "start", "build", "--name", "Build", "--order", "1"],
      { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: okFetch });
    expect(code).toBe(0);
    expect((okFetch as any).last.url).toBe("http://api/v1/teams/acme/projects/web/phases/build");
    expect(JSON.parse((okFetch as any).last.init.body)).toMatchObject({ name: "Build", order: 1, status: "queued" });
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
  it("returns 1 (no crash) when --design-file is missing", async () => {
    const errs: string[] = [];
    const code = await run(["project", "set", "--title", "Web", "--status", "running", "--design-file", "nope.md"],
      { cwd: initDir(), env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: (m: string) => errs.push(m),
        fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).toBe(1);
    expect(errs.join(" ")).toMatch(/could not read --design-file/);
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

// @ts-ignore
import { parseGitHead } from "../../cli/autoloop.mjs";

describe("parseGitHead", () => {
  it("parses sha / ISO committedAt / author / message", () => {
    const out = "deadbeef\n2026-06-02T01:25:49-07:00\nAlice\nfix: thing";
    expect(parseGitHead(out)).toEqual({ sha: "deadbeef", committedAt: "2026-06-02T01:25:49-07:00", author: "Alice", message: "fix: thing" });
  });
});

describe("commit", () => {
  function initDir(currentTaskId: string | null = null) {
    const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentPhaseId: "build", currentTaskId, phases: { build: { name: "Build", order: 1 } }, tasks: {} });
    return dir;
  }
  const gitRun = () => "deadbeef\n2026-06-02T01:25:49-07:00\nAlice\nfix: thing";

  it("auto-creates an implicit 'main' task then PUTs the commit under it", async () => {
    const dir = initDir(); const calls: any[] = [];
    const fetchImpl = async (url: string, init: any) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({}) }; };
    const code = await run(["commit"], { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, gitRun, fetchImpl });
    expect(code).toBe(0);
    expect(calls[0].url).toBe("http://api/v1/teams/acme/projects/web/tasks/main"); // implicit task created
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ phaseId: "build", title: "Main", order: 0, status: "queued", scenarioIds: [] });
    expect(calls[1].url).toBe("http://api/v1/teams/acme/projects/web/tasks/main/commits/deadbeef");
    expect(loadConfig(dir).currentTaskId).toBe("main");
  });

  it("uses --task when given (no implicit task)", async () => {
    const dir = initDir(); let captured: any;
    const code = await run(["commit", "--task", "t7"], { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, gitRun,
      fetchImpl: async (url: string, init: any) => { captured = { url, init }; return { ok: true, status: 200, json: async () => ({}) }; } });
    expect(code).toBe(0);
    expect(captured.url).toBe("http://api/v1/teams/acme/projects/web/tasks/t7/commits/deadbeef");
  });

  it("uses currentTaskId when set (no implicit task)", async () => {
    const dir = initDir("t3"); const calls: any[] = [];
    await run(["commit"], { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, gitRun,
      fetchImpl: async (url: string, init: any) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({}) }; } });
    expect(calls).toHaveLength(1); // no implicit-task PUT
    expect(calls[0].url).toBe("http://api/v1/teams/acme/projects/web/tasks/t3/commits/deadbeef");
  });

  it("exits 1 when no currentPhaseId and no task can be resolved", async () => {
    const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentPhaseId: null, currentTaskId: null, phases: {}, tasks: {} });
    const errs: string[] = [];
    const code = await run(["commit"], { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: (m: string) => errs.push(m), gitRun, fetchImpl: async () => { throw new Error("no"); } });
    expect(code).toBe(1);
    expect(errs.join(" ")).toMatch(/no current phase/i);
  });

  it("exits 1 when git author is empty", async () => {
    const errs: string[] = [];
    const code = await run(["commit", "--task", "t1"], { cwd: initDir(), env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: (m: string) => errs.push(m),
      gitRun: () => "deadbeef\n2026-06-02T01:25:49-07:00\n\nfix: thing", fetchImpl: async () => { throw new Error("no"); } });
    expect(code).toBe(1);
    expect(errs.join(" ")).toMatch(/author/);
  });
});

describe("parseArgs repeated flags", () => {
  it("collects repeated flags into an array", () => {
    const { flags } = parseArgs(["score", "s1", "--criterion", "a=1", "--criterion", "b=2"]);
    expect(flags.criterion).toEqual(["a=1", "b=2"]);
  });
});

describe("goal/scenario/task/doc verbs (request shapes)", () => {
  function initDir() {
    const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentPhaseId: "p1", currentTaskId: null, phases: { p1: { name: "P", order: 1 } }, tasks: {} });
    return dir;
  }
  const cap = () => { const c: any = {}; c.fetchImpl = async (url: string, init: any) => { c.url = url; c.init = init; return { ok: true, status: 200, json: async () => ({ ok: true }) }; }; return c; };
  const base = (dir: string, c: any) => ({ cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: c.fetchImpl });

  it("goal set PUTs the goal", async () => {
    const dir = initDir(); const c = cap();
    expect(await run(["goal", "set", "g1", "--title", "Ship", "--order", "1"], base(dir, c))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/goals/g1");
    expect(JSON.parse(c.init.body)).toMatchObject({ title: "Ship", order: 1 });
  });

  it("task start PUTs the task, records it, and sets currentTaskId", async () => {
    const dir = initDir(); const c = cap();
    expect(await run(["task", "start", "t1", "--phase", "p1", "--name", "Build", "--order", "1", "--scenarios", "s1,s2"], base(dir, c))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/tasks/t1");
    expect(JSON.parse(c.init.body)).toMatchObject({ phaseId: "p1", title: "Build", order: 1, status: "queued", scenarioIds: ["s1", "s2"] });
    expect(loadConfig(dir).currentTaskId).toBe("t1");
  });

  it("doc add derives a docId from the title and sends url content", async () => {
    const dir = initDir(); const c = cap();
    expect(await run(["doc", "add", "--kind", "vision", "--title", "My Vision", "--url", "https://x.com/v"], base(dir, c))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/documents/my-vision");
    expect(JSON.parse(c.init.body)).toMatchObject({ kind: "vision", title: "My Vision", format: "url", content: "https://x.com/v" });
  });

  it("scenario set PUTs the scenario with goalId/title/rubric", async () => {
    const dir = initDir(); const c = cap();
    const rubric = { criteria: [{ id: "c1", name: "C", weight: 1, max: 5 }] };
    writeFileSync(join(dir, "rubric.json"), JSON.stringify(rubric));
    expect(await run(["scenario", "set", "s1", "--goal", "g1", "--title", "Login", "--rubric", "rubric.json"], base(dir, c))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/scenarios/s1");
    expect(JSON.parse(c.init.body)).toMatchObject({ goalId: "g1", title: "Login", rubric });
  });

  it("task set PUTs the task with status", async () => {
    const dir = initDir(); const c = cap();
    expect(await run(["task", "set", "t1", "--status", "completed"], base(dir, c))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/tasks/t1");
    expect(JSON.parse(c.init.body)).toMatchObject({ status: "completed" });
  });

  it("doc add --format json overrides the --file ⇒ markdown inference", async () => {
    const dir = initDir(); const c = cap();
    writeFileSync(join(dir, "map.json"), '{"nodes":[],"edges":[]}');
    expect(await run(["doc", "add", "--id", "product-map", "--kind", "product-map", "--title", "Product map",
      "--format", "json", "--file", "map.json"], base(dir, c))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/documents/product-map");
    expect(JSON.parse(c.init.body)).toMatchObject({ kind: "product-map", title: "Product map", format: "json", content: '{"nodes":[],"edges":[]}' });
  });

  it("doc add without --format keeps the --file ⇒ markdown inference", async () => {
    const dir = initDir(); const c = cap();
    writeFileSync(join(dir, "notes.md"), "# Notes");
    expect(await run(["doc", "add", "--kind", "notes", "--title", "Notes", "--file", "notes.md"], base(dir, c))).toBe(0);
    expect(JSON.parse(c.init.body)).toMatchObject({ format: "markdown", content: "# Notes" });
  });

  it("doc add rejects an unknown --format without calling the API", async () => {
    const dir = initDir();
    const code = await run(["doc", "add", "--kind", "n", "--title", "N", "--format", "yaml", "--url", "https://x.com"],
      { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).not.toBe(0);
  });
});

describe("loop start/set + loop-aware URLs", () => {
  function initDir(extra: Record<string, unknown> = {}) {
    const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentPhaseId: "p1", currentTaskId: null, currentLoopId: null, loops: {}, phases: { p1: { name: "P", order: 1 } }, tasks: {}, ...extra });
    return dir;
  }
  const cap = () => { const c: any = { calls: [] }; c.fetchImpl = async (url: string, init: any) => { c.calls.push({ url, init }); c.url = url; c.init = init; return { ok: true, status: 200, json: async () => ({ ok: true, id: "01XYZ" }) }; }; return c; };
  const base = (dir: string, c: any) => ({ cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: c.fetchImpl });

  it("init seeds currentLoopId:null and loops:{}", async () => {
    const dir = tmp();
    await run(["init", "--team", "acme", "--project", "web", "--url", "http://x"], { cwd: dir, env: {}, log: () => {}, err: () => {} });
    expect(loadConfig(dir)).toMatchObject({ currentLoopId: null, loops: {} });
  });

  it("loop start PUTs the loop, records it, sets currentLoopId", async () => {
    const dir = initDir(); const c = cap();
    expect(await run(["loop", "start", "l1", "--goal", "build search", "--order", "1"], base(dir, c))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/loops/l1");
    expect(JSON.parse(c.init.body)).toMatchObject({ goal: "build search", order: 1, status: "running" });
    const cfg = loadConfig(dir);
    expect(cfg.currentLoopId).toBe("l1");
    expect(cfg.loops.l1).toMatchObject({ goal: "build search", order: 1 });
  });

  it("loop set PUTs the status", async () => {
    const dir = initDir(); const c = cap();
    expect(await run(["loop", "set", "l1", "--status", "completed"], base(dir, c))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/loops/l1");
    expect(JSON.parse(c.init.body)).toMatchObject({ status: "completed" });
  });

  it("with currentLoopId set, task/score/commit URLs are loop-scoped", async () => {
    const dir = initDir({ currentLoopId: "l1", currentTaskId: "t1" });
    const c = cap();
    await run(["task", "start", "t1", "--phase", "p1", "--name", "T", "--order", "1"], base(dir, c));
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/loops/l1/tasks/t1");
    await run(["score", "s1", "--task", "t1", "--composite", "80", "--criterion", "c=3"], base(dir, c));
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/loops/l1/scores");
    const gitRun = () => "deadbeef\n2026-06-02T01:25:49-07:00\nAlice\nfix: thing";
    await run(["commit"], { ...base(dir, c), gitRun });
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/loops/l1/tasks/t1/commits/deadbeef");
  });

  it("without currentLoopId, URLs stay project-direct (legacy)", async () => {
    const dir = initDir({ currentTaskId: "t1" }); const c = cap();
    await run(["task", "start", "t1", "--phase", "p1", "--name", "T", "--order", "1"], base(dir, c));
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/tasks/t1");
  });

  it("loop set --preview-url PUTs previewUrl (no status required)", async () => {
    const dir = initDir(); const c = cap();
    expect(await run(["loop", "set", "l1", "--preview-url", "https://app--l1-abc.web.app"], base(dir, c))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/loops/l1");
    expect(c.init.method).toBe("PUT");
    expect(JSON.parse(c.init.body)).toEqual({ previewUrl: "https://app--l1-abc.web.app" });
  });

  it('loop set --preview-url "" sends null (clear)', async () => {
    const dir = initDir(); const c = cap();
    expect(await run(["loop", "set", "l1", "--preview-url", ""], base(dir, c))).toBe(0);
    expect(JSON.parse(c.init.body)).toEqual({ previewUrl: null });
  });

  it("loop set with both flags sends both fields", async () => {
    const dir = initDir(); const c = cap();
    expect(await run(["loop", "set", "l1", "--status", "running", "--preview-url", "https://x.web.app"], base(dir, c))).toBe(0);
    expect(JSON.parse(c.init.body)).toEqual({ status: "running", previewUrl: "https://x.web.app" });
  });

  it("loop set with no settable flag errors before any network call", async () => {
    const dir = initDir();
    const code = await run(["loop", "set", "l1"], {
      cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {},
      fetchImpl: async () => { throw new Error("should not be called"); },
    });
    expect(code).toBe(1);
  });

  it("terminal --status still clears currentLoopId; --preview-url alone does not", async () => {
    const dir = initDir({ currentLoopId: "l1" }); const c = cap();
    await run(["loop", "set", "l1", "--preview-url", "https://x.web.app"], base(dir, c));
    expect(loadConfig(dir).currentLoopId).toBe("l1");          // untouched
    await run(["loop", "set", "l1", "--status", "completed"], base(dir, c));
    expect(loadConfig(dir).currentLoopId).toBeNull();          // side effect preserved
  });
});

describe("event + vision verbs (request shapes)", () => {
  function initDir() {
    const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentPhaseId: "p1", currentTaskId: "t1", phases: {}, tasks: {} });
    return dir;
  }
  const cap = () => { const c: any = { calls: [] }; c.fetchImpl = async (url: string, init: any) => { c.calls.push({ url, init }); c.url = url; c.init = init; return { ok: true, status: 200, json: async () => ({ ok: true, id: "01XYZ" }) }; }; return c; };
  const base = (dir: string, c: any) => ({ cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: c.fetchImpl });

  it("score POSTs criteria map + composite", async () => {
    const dir = initDir(); const c = cap();
    expect(await run(["score", "s1", "--task", "t1", "--criterion", "correctness=4", "--criterion", "ux=3", "--composite", "82", "--note", "ok"], base(dir, c))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/scores");
    expect(c.init.method).toBe("POST");
    expect(JSON.parse(c.init.body)).toMatchObject({ scenarioId: "s1", taskId: "t1", criteria: { correctness: 4, ux: 3 }, composite: 82, note: "ok" });
  });
  it("test-run POSTs passed/failed + repeated issues", async () => {
    const dir = initDir(); const c = cap();
    expect(await run(["test-run", "s1", "--task", "t1", "--passed", "8", "--failed", "1", "--issue", "a", "--issue", "b"], base(dir, c))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/testRuns");
    expect(JSON.parse(c.init.body)).toMatchObject({ scenarioId: "s1", taskId: "t1", passed: 8, failed: 1, issues: ["a", "b"] });
  });
  it("revise POSTs trigger + parsed changes", async () => {
    const dir = initDir(); const c = cap();
    expect(await run(["revise", "--scenario", "s1", "--reason", "short", "--change", "add:t9", "--change", "drop:t3"], base(dir, c))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/revisions");
    expect(JSON.parse(c.init.body)).toMatchObject({ trigger: { scenarioId: "s1", reason: "short" }, changes: [{ op: "add", taskId: "t9" }, { op: "drop", taskId: "t3" }] });
  });
  it("vision import PUTs each goal, scenario, and document", async () => {
    const dir = initDir(); const c = cap();
    writeFileSync(join(dir, "vision.json"), JSON.stringify({
      goals: [{ id: "g1", title: "Ship", order: 1 }],
      scenarios: [{ id: "s1", goalId: "g1", title: "S", rubric: { criteria: [{ id: "c1", name: "C", weight: 1, max: 5 }] } }],
      documents: [{ id: "d1", kind: "vision", title: "V", format: "markdown", content: "# V" }],
    }));
    expect(await run(["vision", "import", "--file", "vision.json"], base(dir, c))).toBe(0);
    const urls = c.calls.map((x: any) => x.url);
    expect(urls).toContain("http://api/v1/teams/acme/projects/web/goals/g1");
    expect(urls).toContain("http://api/v1/teams/acme/projects/web/scenarios/s1");
    expect(urls).toContain("http://api/v1/teams/acme/projects/web/documents/d1");
  });

  it("test-run includes --summary in the body", async () => {
    const dir = initDir(); const c = cap();
    await run(["test-run", "s1", "--task", "t1", "--passed", "1", "--failed", "0", "--summary", "ran fine"], base(dir, c));
    expect(JSON.parse(c.init.body)).toMatchObject({ summary: "ran fine" });
  });

  it("test-run reads --summary-file and it wins over --summary", async () => {
    const dir = initDir(); const c = cap();
    writeFileSync(join(dir, "sum.md"), "# from file");
    await run(["test-run", "s1", "--task", "t1", "--passed", "1", "--failed", "0", "--summary", "inline", "--summary-file", "sum.md"], base(dir, c));
    expect(JSON.parse(c.init.body).summary).toBe("# from file");
  });

  it("vision propose POSTs op/targetId/payload/reason to the project-level URL", async () => {
    const dir = initDir(); const c = cap();
    writeFileSync(join(dir, "payload.json"), JSON.stringify({
      goalId: "g1", title: "New scenario", rubric: { criteria: [{ id: "c1", name: "C", weight: 1, max: 5 }] },
    }));
    expect(await run(["vision", "propose", "--op", "upsert-scenario", "--target", "s9",
      "--file", "payload.json", "--reason", "found while testing login"], base(dir, c))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/vision-changes");
    expect(c.init.method).toBe("POST");
    expect(JSON.parse(c.init.body)).toMatchObject({
      op: "upsert-scenario", targetId: "s9", reason: "found while testing login",
      payload: { goalId: "g1", title: "New scenario" },
    });
  });

  it("vision propose stays project-level even with currentLoopId set, and carries --origin-loop", async () => {
    const dir = tmp(); const c = cap();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentPhaseId: "p1", currentTaskId: "t1", currentLoopId: "l1", phases: {}, tasks: {} });
    writeFileSync(join(dir, "p.json"), JSON.stringify({ title: "G" }));
    await run(["vision", "propose", "--op", "upsert-goal", "--target", "g1", "--file", "p.json",
      "--reason", "r", "--origin-loop", "l1"], base(dir, c));
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/vision-changes"); // no /loops/l1 segment
    expect(JSON.parse(c.init.body).originLoopId).toBe("l1");
  });

  it("vision propose requires --reason", async () => {
    const dir = initDir();
    const code = await run(["vision", "propose", "--op", "upsert-goal", "--target", "g1", "--file", "p.json"],
      { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).not.toBe(0);
  });

  it("vision propose rejects an unknown --op", async () => {
    const dir = initDir();
    writeFileSync(join(dir, "p.json"), JSON.stringify({ title: "G" }));
    const code = await run(["vision", "propose", "--op", "delete-goal", "--target", "g1", "--file", "p.json", "--reason", "r"],
      { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).not.toBe(0);
  });

  it("vision propose errors on an unreadable --file", async () => {
    const dir = initDir();
    const code = await run(["vision", "propose", "--op", "upsert-goal", "--target", "g1", "--file", "missing.json", "--reason", "r"],
      { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).not.toBe(0);
  });
});

describe("bug add/set verbs", () => {
  function initDir(extra: Record<string, unknown> = {}) {
    const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentPhaseId: "p1", currentTaskId: "t1", currentLoopId: null, loops: {}, phases: {}, tasks: {}, ...extra });
    return dir;
  }
  const cap = () => { const c: any = { calls: [] }; c.fetchImpl = async (url: string, init: any) => { c.calls.push({ url, init }); c.url = url; c.init = init; return { ok: true, status: 200, json: async () => ({ ok: true }) }; }; return c; };
  const base = (dir: string, c: any) => ({ cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: c.fetchImpl });

  it("bug add PUTs the bug with default status open", async () => {
    const dir = initDir(); const c = cap();
    expect(await run(["bug", "add", "b1", "--title", "Login breaks", "--severity", "high", "--scenario", "s1", "--task", "t1"], base(dir, c))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/bugs/b1");
    expect(c.init.method).toBe("PUT");
    expect(JSON.parse(c.init.body)).toMatchObject({ title: "Login breaks", status: "open", severity: "high", scenarioId: "s1", taskId: "t1" });
  });

  it("bug set PUTs a status update", async () => {
    const dir = initDir(); const c = cap();
    expect(await run(["bug", "set", "b1", "--status", "fixed"], base(dir, c))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/bugs/b1");
    expect(JSON.parse(c.init.body)).toMatchObject({ status: "fixed" });
  });

  it("bug add is loop-scoped when currentLoopId is set", async () => {
    const dir = initDir({ currentLoopId: "l1" }); const c = cap();
    await run(["bug", "add", "b1", "--title", "X"], base(dir, c));
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/loops/l1/bugs/b1");
  });

  it("bug add rejects an unknown severity", async () => {
    const dir = initDir(); const errs: string[] = [];
    const code = await run(["bug", "add", "b1", "--title", "X", "--severity", "blocker"], { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: (m: string) => errs.push(m), fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).not.toBe(0);
  });

  it("bug set requires at least one field", async () => {
    const dir = initDir(); const errs: string[] = [];
    const code = await run(["bug", "set", "b1"], { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: (m: string) => errs.push(m), fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).not.toBe(0);
  });
});

describe("messages pull/ack/send verbs", () => {
  function initDir(extra: Record<string, unknown> = {}) {
    const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentPhaseId: "p1", currentTaskId: "t1", currentLoopId: null, loops: {}, phases: {}, tasks: {}, ...extra });
    return dir;
  }
  // cap captures URL+init, returns ok with json body; logsOut captures log() calls
  const cap = (jsonBody: any = { ok: true }) => {
    const c: any = { calls: [] };
    c.fetchImpl = async (url: string, init: any) => { c.calls.push({ url, init }); c.url = url; c.init = init; return { ok: true, status: 200, json: async () => jsonBody }; };
    return c;
  };
  const base = (dir: string, c: any, logsOut: string[] = [], errsOut: string[] = []) => ({
    cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" },
    log: (m: string) => logsOut.push(m),
    err: (m: string) => errsOut.push(m),
    fetchImpl: c.fetchImpl,
  });

  it("messages send POSTs to project-level /messages with {text}, no loopSeg even when currentLoopId set", async () => {
    const dir = initDir({ currentLoopId: "l1" }); const c = cap();
    const code = await run(["messages", "send", "--text", "hi"], base(dir, c));
    expect(code).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/messages");
    expect(c.init.method).toBe("POST");
    expect(JSON.parse(c.init.body)).toMatchObject({ text: "hi" });
  });

  it("messages send requires --text", async () => {
    const dir = initDir(); const errs: string[] = [];
    const code = await run(["messages", "send"], { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: (m: string) => errs.push(m), fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).toBe(1);
    expect(errs.join(" ")).toMatch(/--text/);
  });

  it("messages ack POSTs to project-level /messages/:id/ack (ULID id, no validateId)", async () => {
    const dir = initDir({ currentLoopId: "l1" }); const c = cap();
    const code = await run(["messages", "ack", "01JXKM8F3XABCDE12345"], base(dir, c));
    expect(code).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/messages/01JXKM8F3XABCDE12345/ack");
    expect(c.init.method).toBe("POST");
  });

  it("messages ack requires a non-empty id", async () => {
    const dir = initDir(); const errs: string[] = [];
    const code = await run(["messages", "ack"], { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: (m: string) => errs.push(m), fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).toBe(1);
    expect(errs.join(" ")).toMatch(/id/i);
  });

  it("messages pull GETs project-level /messages and prints JSON to log (stdout)", async () => {
    const dir = initDir({ currentLoopId: "l1" });
    const msgs = [{ id: "01JXKM8F3XABCDE12345", text: "hi" }];
    const c = cap({ messages: msgs });
    const logs: string[] = [];
    const code = await run(["messages", "pull"], base(dir, c, logs));
    expect(code).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/messages");
    expect(c.init.method).toBe("GET");
    // printed JSON should contain the message id
    expect(logs.join("\n")).toContain("01JXKM8F3XABCDE12345");
  });

  it("messages pull is project-level even when no currentLoopId", async () => {
    const dir = initDir(); const c = cap({ messages: [] });
    const logs: string[] = [];
    const code = await run(["messages", "pull"], base(dir, c, logs));
    expect(code).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/messages");
  });

  it("messages pull --check exits 0 silently when pending messages exist (GET only, no ack)", async () => {
    const dir = initDir(); const c = cap({ ok: true, messages: [{ id: "m1", text: "hi" }] });
    const logs: string[] = [];
    expect(await run(["messages", "pull", "--check"], base(dir, c, logs))).toBe(0);
    expect(logs.length).toBe(0);                       // silent
    expect(c.calls.length).toBe(1);                    // exactly ONE call …
    expect(c.calls[0].init.method).toBe("GET");        // … and it's a GET (never acks)
    expect(c.calls[0].url).toBe("http://api/v1/teams/acme/projects/web/messages");
  });

  it("messages pull --check exits 1 when there are no pending messages", async () => {
    const dir = initDir(); const c = cap({ ok: true, messages: [] });
    expect(await run(["messages", "pull", "--check"], base(dir, c))).toBe(1);
  });

  it("messages pull --check exits 1 on a network error", async () => {
    const dir = initDir();
    const code = await run(["messages", "pull", "--check"],
      { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: async () => { throw new Error("net"); } });
    expect(code).toBe(1);
  });
});

describe("report() pendingMessages notice", () => {
  function initDir() {
    const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentPhaseId: "p1", currentTaskId: "t1", currentLoopId: null, loops: {}, phases: {}, tasks: {} });
    return dir;
  }

  it("prints a 📨 notice on err when task set response has pendingMessages", async () => {
    const dir = initDir();
    const errs: string[] = [];
    const fetchImpl = async () => ({
      ok: true, status: 200,
      json: async () => ({ ok: true, pendingMessages: [{ id: "01JXKM8F3XABCDE12345", text: "hi" }] }),
    });
    const code = await run(["task", "set", "t1", "--status", "completed"],
      { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: (m: string) => errs.push(m), fetchImpl });
    expect(code).toBe(0);
    expect(errs.join(" ")).toMatch(/📨/);
    expect(errs.join(" ")).toMatch(/message/i);
  });

  it("does NOT print a notice when pendingMessages is empty", async () => {
    const dir = initDir();
    const errs: string[] = [];
    const fetchImpl = async () => ({
      ok: true, status: 200,
      json: async () => ({ ok: true, pendingMessages: [] }),
    });
    await run(["task", "set", "t1", "--status", "completed"],
      { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: (m: string) => errs.push(m), fetchImpl });
    expect(errs.join(" ")).not.toMatch(/📨/);
  });

  it("does NOT break when response has no pendingMessages (existing stubs)", async () => {
    const dir = initDir();
    const errs: string[] = [];
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
    const code = await run(["task", "set", "t1", "--status", "completed"],
      { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: (m: string) => errs.push(m), fetchImpl });
    expect(code).toBe(0);
    expect(errs.join(" ")).not.toMatch(/📨/);
  });

  it("does NOT break when response stub has no .json method (legacy stub shape)", async () => {
    const dir = initDir();
    const errs: string[] = [];
    // minimal stub: no json() method at all
    const fetchImpl = async () => ({ ok: true, status: 200 } as any);
    const code = await run(["task", "set", "t1", "--status", "completed"],
      { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: (m: string) => errs.push(m), fetchImpl });
    expect(code).toBe(0);
  });
});

describe("back-compat: pre-rename daloop names still work", () => {
  it("loadConfig reads a legacy .daloop.json when no .autoloop.json exists", () => {
    const dir = tmp();
    writeFileSync(join(dir, ".daloop.json"), JSON.stringify({ apiUrl: "http://api", teamId: "acme", projectSlug: "web" }) + "\n");
    expect(loadConfig(dir)).toMatchObject({ teamId: "acme", projectSlug: "web" });
  });
  it("run authenticates with the legacy DALOOP_API_KEY env var (no AUTOLOOP_API_KEY set)", async () => {
    const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentLoopId: null, loops: {}, currentPhaseId: "p1", currentTaskId: "t1", phases: {}, tasks: {} });
    let auth: string | undefined;
    const fetchImpl = async (_url: string, init: any) => { auth = init.headers.Authorization; return { ok: true, status: 200, json: async () => ({ ok: true }) } as any; };
    const code = await run(["task", "set", "t1", "--status", "completed"],
      { cwd: dir, env: { DALOOP_API_KEY: "dl_legacy" }, log: () => {}, err: () => {}, fetchImpl });
    expect(code).toBe(0);
    expect(auth).toBe("Bearer dl_legacy"); // legacy key forwarded via the AUTOLOOP_* fallback
  });
});

describe("verify verb", () => {
  function initDir(extra: Record<string, unknown> = {}) {
    const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentPhaseId: "p1", currentTaskId: "t1", currentLoopId: null, loops: {}, phases: {}, tasks: {}, ...extra });
    return dir;
  }
  const cap = () => { const c: any = { calls: [] }; c.fetchImpl = async (url: string, init: any) => { c.calls.push({ url, init }); c.url = url; c.init = init; return { ok: true, status: 200, json: async () => ({ ok: true, id: "01XYZ" }) }; }; return c; };
  const base = (dir: string, c: any) => ({ cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: c.fetchImpl });

  it("verify POSTs scenarioId + uppercase ULID testRunId + verdict", async () => {
    const dir = initDir(); const c = cap();
    expect(await run(["verify", "s1", "--test-run", "01ARZ3NDEKTSV4RRFFQ69G5FAV", "--verdict", "confirmed"], base(dir, c))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/verifications");
    expect(c.init.method).toBe("POST");
    expect(JSON.parse(c.init.body)).toMatchObject({ scenarioId: "s1", testRunId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", verdict: "confirmed" });
  });

  it("verify is loop-scoped when currentLoopId is set", async () => {
    const dir = initDir({ currentLoopId: "l1" }); const c = cap();
    await run(["verify", "s1", "--test-run", "01A", "--verdict", "refuted"], base(dir, c));
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/loops/l1/verifications");
  });

  it("verify includes --task and --summary in the body", async () => {
    const dir = initDir(); const c = cap();
    await run(["verify", "s1", "--test-run", "01A", "--verdict", "confirmed", "--task", "t1", "--summary", "npm test → 6/6"], base(dir, c));
    expect(JSON.parse(c.init.body)).toMatchObject({ taskId: "t1", summary: "npm test → 6/6" });
  });

  it("verify reads --summary-file and it wins over --summary", async () => {
    const dir = initDir(); const c = cap();
    writeFileSync(join(dir, "ver.md"), "# replayed\n6/6");
    await run(["verify", "s1", "--test-run", "01A", "--verdict", "confirmed", "--summary", "inline", "--summary-file", "ver.md"], base(dir, c));
    expect(JSON.parse(c.init.body).summary).toBe("# replayed\n6/6");
  });

  it("verify rejects an unknown verdict without calling fetch", async () => {
    const dir = initDir();
    const code = await run(["verify", "s1", "--test-run", "01A", "--verdict", "passed"],
      { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).not.toBe(0);
  });

  it("verify requires --test-run", async () => {
    const dir = initDir();
    const code = await run(["verify", "s1", "--verdict", "confirmed"],
      { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).not.toBe(0);
  });

  it("verify rejects a bare --test-run (boolean flag) without calling fetch", async () => {
    const dir = initDir();
    const code = await run(["verify", "s1", "--test-run", "--verdict", "confirmed"],
      { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).not.toBe(0);
  });

  it("event verbs surface the server id (autoloop: id <ULID>)", async () => {
    const dir = initDir(); const c = cap(); const errs: string[] = [];
    await run(["test-run", "s1", "--task", "t1", "--passed", "1", "--failed", "0"],
      { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: (m: string) => errs.push(m), fetchImpl: c.fetchImpl });
    expect(errs.some((m) => m.includes("id 01XYZ"))).toBe(true);
  });
});

describe("idea add/set/list verbs", () => {
  function initDir(extra: Record<string, unknown> = {}) {
    const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentPhaseId: "p1", currentTaskId: "t1", currentLoopId: null, loops: {}, phases: {}, tasks: {}, ...extra });
    return dir;
  }
  const cap = (jsonBody: any = { ok: true }) => { const c: any = { calls: [] }; c.fetchImpl = async (url: string, init: any) => { c.calls.push({ url, init }); c.url = url; c.init = init; return { ok: true, status: 200, json: async () => jsonBody }; }; return c; };
  const base = (dir: string, c: any, logsOut: string[] = []) => ({ cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: (m: string) => logsOut.push(m), err: () => {}, fetchImpl: c.fetchImpl });

  it("idea add PUTs with defaults status=proposed order=100", async () => {
    const dir = initDir(); const c = cap();
    expect(await run(["idea", "add", "idea-dark-mode", "--title", "Dark mode", "--rationale", "users asked", "--origin-loop", "loop-1"], base(dir, c))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/ideas/idea-dark-mode");
    expect(c.init.method).toBe("PUT");
    expect(JSON.parse(c.init.body)).toMatchObject({ title: "Dark mode", status: "proposed", order: 100, rationale: "users asked", originLoopId: "loop-1" });
  });

  it("idea add is project-level even when currentLoopId is set (no loopSeg)", async () => {
    const dir = initDir({ currentLoopId: "l1" }); const c = cap();
    await run(["idea", "add", "i1", "--title", "X"], base(dir, c));
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/ideas/i1");
  });

  it("idea add reads --rationale-file (wins over --rationale) and validates --status", async () => {
    const dir = initDir(); const c = cap();
    writeFileSync(join(dir, "why.md"), "# from file");
    await run(["idea", "add", "i1", "--title", "X", "--rationale", "inline", "--rationale-file", "why.md", "--status", "accepted"], base(dir, c));
    const body = JSON.parse(c.init.body);
    expect(body.rationale).toBe("# from file");
    expect(body.status).toBe("accepted");
    const code = await run(["idea", "add", "i2", "--title", "X", "--status", "maybe"], { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).toBe(1);
  });

  it("idea add requires --title", async () => {
    const dir = initDir();
    const code = await run(["idea", "add", "i1"], { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).toBe(1);
  });

  it("idea set PUTs a partial update (done + built-in-loop)", async () => {
    const dir = initDir(); const c = cap();
    expect(await run(["idea", "set", "i1", "--status", "done", "--built-in-loop", "loop-2"], base(dir, c))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/ideas/i1");
    expect(JSON.parse(c.init.body)).toEqual({ status: "done", builtInLoopId: "loop-2" });
  });

  it("idea set requires at least one field", async () => {
    const dir = initDir();
    const code = await run(["idea", "set", "i1"], { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).toBe(1);
  });

  it("idea list GETs project-level /ideas and prints one line per idea", async () => {
    const dir = initDir({ currentLoopId: "l1" });
    const c = cap({ ok: true, ideas: [
      { id: "a1", status: "accepted", order: 50, title: "A" },
      { id: "p1", status: "proposed", order: 100, title: "P" },
    ] });
    const logs: string[] = [];
    expect(await run(["idea", "list"], base(dir, c, logs))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/ideas");
    expect(c.init.method).toBe("GET");
    expect(logs.join("\n")).toContain("[accepted] 50 a1 — A");
    expect(logs.join("\n")).toContain("[proposed] 100 p1 — P");
  });
});

describe("loop resume", () => {
  function initDir(extra: Record<string, unknown> = {}) {
    const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentPhaseId: null, currentTaskId: null, currentLoopId: null, loops: {}, phases: {}, tasks: {}, ...extra });
    return dir;
  }
  const state = (over: Record<string, unknown> = {}) => ({
    loop: { id: "l1", goal: "g", order: 1, status: "running" },
    project: { slug: "web", title: "W", status: "running", currentLoopId: "l1" },
    phases: [{ id: "p1", name: "A", order: 1, status: "running" }, { id: "p2", name: "B", order: 2, status: "queued" }],
    tasks: [
      { id: "t1", phaseId: "p1", title: "T1", order: 1, status: "completed", scenarioIds: [] },
      { id: "t3", phaseId: "p2", title: "T3", order: 1, status: "queued", scenarioIds: [] },
      { id: "t2", phaseId: "p1", title: "T2", order: 2, status: "running", scenarioIds: [] },
    ],
    scenarios: [], openBugs: [], pendingMessages: [{ id: "m1", text: "hi", createdAt: null }],
    ...over,
  });
  // capture every GET; respond per-URL via a map, default = the given body
  const cap = (bodyByUrl: Record<string, unknown>, fallback: unknown) => {
    const c: any = { calls: [] as string[] };
    c.fetchImpl = async (url: string) => {
      c.calls.push(url);
      return { ok: true, status: 200, json: async () => (bodyByUrl[url] ?? fallback) };
    };
    return c;
  };
  const base = (dir: string, c: any, logs: string[] = [], errs: string[] = []) => ({
    cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" },
    log: (m: string) => logs.push(m), err: (m: string) => errs.push(m), fetchImpl: c.fetchImpl,
  });

  it("GETs the loop-scoped state from cfg.currentLoopId and prints header + pretty JSON", async () => {
    const dir = initDir({ currentLoopId: "l1" });
    const c = cap({}, { ok: true, state: state() });
    const logs: string[] = [];
    expect(await run(["loop", "resume"], base(dir, c, logs))).toBe(0);
    expect(c.calls).toEqual(["http://api/v1/teams/acme/projects/web/loops/l1/state"]);
    const out = logs.join("\n");
    expect(out).toContain("loop l1 — running");
    expect(out).toContain("1/3 tasks terminal, 1 pending messages");
    expect(out).toContain("next: t2 — T2 (phase p1)"); // phase order then task order
    expect(out).toContain('"pendingMessages"');        // pretty JSON bundle
  });

  it("an explicit positional loopId wins over cfg.currentLoopId", async () => {
    const dir = initDir({ currentLoopId: "l1" });
    const c = cap({}, { ok: true, state: state({ loop: { id: "l9", goal: "g", order: 9, status: "running" } }) });
    expect(await run(["loop", "resume", "l9"], base(dir, c))).toBe(0);
    expect(c.calls).toEqual(["http://api/v1/teams/acme/projects/web/loops/l9/state"]);
  });

  it("falls back to the server project's currentLoopId when cfg has none (two GETs)", async () => {
    const dir = initDir(); // currentLoopId: null
    const c = cap({
      "http://api/v1/teams/acme/projects/web/state": { ok: true, state: state({ loop: null }) },
    }, { ok: true, state: state() });
    expect(await run(["loop", "resume"], base(dir, c))).toBe(0);
    expect(c.calls).toEqual([
      "http://api/v1/teams/acme/projects/web/state",
      "http://api/v1/teams/acme/projects/web/loops/l1/state",
    ]);
  });

  it("prints 'no active loop' (still exit 0) when the loop is terminal", async () => {
    const dir = initDir({ currentLoopId: "l1" });
    const c = cap({}, { ok: true, state: state({ loop: { id: "l1", goal: "g", order: 1, status: "completed" } }) });
    const logs: string[] = []; const errs: string[] = [];
    expect(await run(["loop", "resume"], base(dir, c, logs, errs))).toBe(0);
    expect(errs.join(" ")).toMatch(/no active loop/);
  });

  it("--check: exit 0 and silent for a running loop; 1 for paused/terminal/none/network-error", async () => {
    const dir = initDir({ currentLoopId: "l1" });
    const logs: string[] = [];
    const mk = (status: string) => cap({}, { ok: true, state: state({ loop: { id: "l1", goal: "g", order: 1, status } }) });
    expect(await run(["loop", "resume", "--check"], base(dir, mk("running"), logs))).toBe(0);
    expect(logs.length).toBe(0); // silent
    expect(await run(["loop", "resume", "--check"], base(dir, mk("paused")))).toBe(1);
    expect(await run(["loop", "resume", "--check"], base(dir, mk("completed")))).toBe(1);
    const noLoop = cap({}, { ok: true, state: state({ loop: null }) });
    expect(await run(["loop", "resume", "--check"], base(dir, noLoop))).toBe(1);
    const boom = { fetchImpl: async () => { throw new Error("net down"); } };
    expect(await run(["loop", "resume", "--check"], { ...base(dir, boom), fetchImpl: boom.fetchImpl })).toBe(1);
  });
});

describe("firstNonTerminalTask / isResumable (pure)", () => {
  it("orders by phase order then task order and skips terminal tasks", () => {
    const s = {
      phases: [{ id: "p2", order: 2 }, { id: "p1", order: 1 }],
      tasks: [
        { id: "a", phaseId: "p2", order: 1, status: "queued" },
        { id: "b", phaseId: "p1", order: 2, status: "queued" },
        { id: "c", phaseId: "p1", order: 1, status: "completed" },
      ],
    };
    expect(firstNonTerminalTask(s)!.id).toBe("b");
  });
  it("isResumable: non-terminal AND non-paused only", () => {
    const mk = (status: string | null) => ({ loop: status ? { status } : null });
    expect(isResumable(mk("running"))).toBe(true);
    expect(isResumable(mk("blocked"))).toBe(true);
    expect(isResumable(mk("paused"))).toBe(false);
    expect(isResumable(mk("completed"))).toBe(false);
    expect(isResumable(mk(null))).toBe(false); // project-direct: loop is null ⇒ not --check-resumable
  });
});

describe("lock primitives (pure)", () => {
  it("findClaudeSessionPid walks ancestors to the nearest claude process", () => {
    const tree: Record<number, { ppid: number; comm: string }> = {
      100: { ppid: 90, comm: "node" },                       // the CLI itself
      90: { ppid: 80, comm: "/bin/zsh" },                    // Bash-tool shell
      80: { ppid: 1, comm: "claude" },                       // the session
    };
    const ps = (pid: number) => tree[pid] ?? null;
    expect(findClaudeSessionPid(100, ps)).toEqual({ pid: 80, found: true });
  });
  it("falls back to the direct parent when no claude ancestor exists", () => {
    const tree: Record<number, { ppid: number; comm: string }> = {
      100: { ppid: 90, comm: "node" }, 90: { ppid: 1, comm: "/bin/zsh" },
    };
    expect(findClaudeSessionPid(100, (p: number) => tree[p] ?? null)).toEqual({ pid: 90, found: false });
  });
  it("evaluateLock classifies none/dead/ours/live-other", () => {
    const alive = () => true, dead = () => false;
    expect(evaluateLock(null, alive, 1)).toBe("none");
    expect(evaluateLock({ pid: 42 }, dead, 1)).toBe("dead");
    expect(evaluateLock({ pid: 42 }, alive, 42)).toBe("ours");
    expect(evaluateLock({ pid: 42 }, alive, 1)).toBe("live-other");
    expect(evaluateLock({ pid: 42 }, alive, null)).toBe("live-other");
  });
});

describe("lock acquire / lock release", () => {
  function setup(extra: Record<string, unknown> = {}) {
    const home = tmp(); const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentLoopId: null, loops: {}, currentPhaseId: null, currentTaskId: null, phases: {}, tasks: {}, ...extra });
    return { home, dir, lockFile: join(home, ".autoloop", "run", "acme-web.lock") };
  }
  const deps = (s: { home: string; dir: string }, over: Record<string, unknown> = {}) => ({
    cwd: s.dir, env: { AUTOLOOP_API_KEY: "al_k", HOME: s.home },
    log: () => {}, err: () => {}, fetchImpl: async () => { throw new Error("no network in lock verbs"); },
    ...over,
  });

  it("acquire --pid writes the lockfile under ~/.autoloop/run/<teamId>-<slug>.lock", async () => {
    const s = setup();
    expect(await run(["lock", "acquire", "--pid", "4242"], deps(s))).toBe(0);
    expect(JSON.parse(readFileSync(s.lockFile, "utf8")).pid).toBe(4242);
  });

  it("acquire fails (exit 1) when a DIFFERENT live pid holds the lock", async () => {
    const s = setup();
    await run(["lock", "acquire", "--pid", "111"], deps(s, { isAlive: () => true }));
    const errs: string[] = [];
    expect(await run(["lock", "acquire", "--pid", "222"], deps(s, { isAlive: () => true, err: (m: string) => errs.push(m) }))).toBe(1);
    expect(JSON.parse(readFileSync(s.lockFile, "utf8")).pid).toBe(111); // unchanged
    expect(errs.join(" ")).toMatch(/held by live pid 111/);
  });

  it("acquire steals the lock when the recorded pid is dead", async () => {
    const s = setup();
    await run(["lock", "acquire", "--pid", "111"], deps(s));
    expect(await run(["lock", "acquire", "--pid", "222"], deps(s, { isAlive: () => false }))).toBe(0);
    expect(JSON.parse(readFileSync(s.lockFile, "utf8")).pid).toBe(222);
  });

  it("acquire re-acquire by the SAME pid succeeds (ours)", async () => {
    const s = setup();
    await run(["lock", "acquire", "--pid", "111"], deps(s, { isAlive: () => true }));
    expect(await run(["lock", "acquire", "--pid", "111"], deps(s, { isAlive: () => true }))).toBe(0);
  });

  it("acquire without --pid records the claude ancestor found via psLookup", async () => {
    const s = setup();
    const tree: Record<number, { ppid: number; comm: string }> = {
      [process.pid]: { ppid: 7000, comm: "node" }, 7000: { ppid: 6000, comm: "zsh" }, 6000: { ppid: 1, comm: "claude" },
    };
    expect(await run(["lock", "acquire"], deps(s, { psLookup: (p: number) => tree[p] ?? null }))).toBe(0);
    expect(JSON.parse(readFileSync(s.lockFile, "utf8")).pid).toBe(6000);
  });

  it("release removes the lockfile; release with no lock is a no-op exit 0", async () => {
    const s = setup();
    await run(["lock", "acquire", "--pid", "111"], deps(s));
    expect(await run(["lock", "release"], deps(s))).toBe(0);
    expect(existsSync(s.lockFile)).toBe(false);
    expect(await run(["lock", "release"], deps(s))).toBe(0);
  });
});

describe("relaunch decisions (pure)", () => {
  it("backoffExceeded: blocks the 4th relaunch within a rolling 30-min window", () => {
    const now = 1_000_000_000;
    const min = 60_000;
    expect(backoffExceeded([], now)).toBe(false);
    expect(backoffExceeded([now - 1 * min, now - 2 * min], now)).toBe(false);     // 2 recent → a 3rd is fine
    expect(backoffExceeded([now - 1 * min, now - 2 * min, now - 3 * min], now)).toBe(true); // 3 recent → 4th blocked
    expect(backoffExceeded([now - 31 * min, now - 40 * min, now - 50 * min], now)).toBe(false); // all outside window
  });

  it("decideSessionEndRelaunch: relaunch only when no live foreign lock, resumable, and under backoff", () => {
    expect(decideSessionEndRelaunch({ lockState: "live-other", resumable: true, backoff: false }).relaunch).toBe(false);
    expect(decideSessionEndRelaunch({ lockState: "none", resumable: false, backoff: false }).relaunch).toBe(false);
    expect(decideSessionEndRelaunch({ lockState: "none", resumable: true, backoff: true }).relaunch).toBe(false);
    expect(decideSessionEndRelaunch({ lockState: "none", resumable: true, backoff: false }).relaunch).toBe(true);
    expect(decideSessionEndRelaunch({ lockState: "dead", resumable: true, backoff: false }).relaunch).toBe(true);
    // "ours" = the lock belongs to THIS ending session — it may hand off to a relaunch
    expect(decideSessionEndRelaunch({ lockState: "ours", resumable: true, backoff: false }).relaunch).toBe(true);
  });

  it("decideWake: wake only when no live lock AND loop is paused AND messages are pending", () => {
    expect(decideWake({ lockState: "live-other", loopStatus: "paused", hasPendingMessages: true }).wake).toBe(false);
    expect(decideWake({ lockState: "none", loopStatus: "running", hasPendingMessages: true }).wake).toBe(false);
    expect(decideWake({ lockState: "none", loopStatus: "paused", hasPendingMessages: false }).wake).toBe(false);
    expect(decideWake({ lockState: "none", loopStatus: undefined, hasPendingMessages: true }).wake).toBe(false);
    expect(decideWake({ lockState: "none", loopStatus: "paused", hasPendingMessages: true }).wake).toBe(true);
    expect(decideWake({ lockState: "dead", loopStatus: "paused", hasPendingMessages: true }).wake).toBe(true);
  });

  it("decideStop: block while live & progressing/under-cap; allow on terminal/paused/pending-stop/idle-cap", () => {
    const live = { loopStatus: "running", hasPendingStop: false, progressed: true, idleCount: 0, idleMax: 3 };
    expect(decideStop(live).block).toBe(true);                                   // progressing → keep going
    expect(decideStop({ ...live, loopStatus: "completed" }).block).toBe(false);  // terminal → allow
    expect(decideStop({ ...live, loopStatus: undefined }).block).toBe(false);    // no loop → allow
    expect(decideStop({ ...live, loopStatus: "paused" }).block).toBe(false);     // paused → allow
    expect(decideStop({ ...live, hasPendingStop: true }).block).toBe(false);     // user stopping → allow
    expect(decideStop({ ...live, progressed: false, idleCount: 0 }).block).toBe(true);  // 1st idle → block
    expect(decideStop({ ...live, progressed: false, idleCount: 2 }).block).toBe(false); // idleCount+1>=3 → allow
    expect(decideStop({ ...live, progressed: false, idleCount: 2 }).wedged).toBe(true); // …flagged wedged
  });

  it("stopFingerprint changes when the loop advances, stable otherwise", () => {
    const base = {
      loop: { status: "running", currentPhaseId: "p1", currentTaskId: "t1" },
      phases: [{ id: "p1", status: "running" }],
      tasks: [{ id: "t1", status: "running" }, { id: "t2", status: "queued" }],
      openBugs: [{ id: "b1" }],
      scenarios: [{ id: "s1", latestComposite: 70, latestTestRun: { passed: 1, failed: 1 } }],
    };
    const fp = stopFingerprint(base);
    expect(stopFingerprint(structuredClone(base))).toBe(fp);                 // identical → same
    const advanced = structuredClone(base); advanced.tasks[0].status = "completed";
    expect(stopFingerprint(advanced)).not.toBe(fp);                          // task completed → changed
    const scored = structuredClone(base); scored.scenarios[0].latestComposite = 85;
    expect(stopFingerprint(scored)).not.toBe(fp);                            // new score → changed
  });
});

describe("parseEnvFile / loadAutoloopEnv (~/.autoloop/env)", () => {
  it("parses KEY=VALUE lines; values may contain '='; skips comments, blanks and no-'=' lines", () => {
    expect(parseEnvFile("AUTOLOOP_API_KEY=al_k\nAUTOLOOP_API_URL=http://x?a=1&b=2\n\n# a comment\nnot a kv line\n=novalue\nCLAUDE_BIN=/opt/x/claude"))
      .toEqual({ AUTOLOOP_API_KEY: "al_k", AUTOLOOP_API_URL: "http://x?a=1&b=2", CLAUDE_BIN: "/opt/x/claude" });
    expect(parseEnvFile("")).toEqual({});
  });

  it("file fills missing keys, real env wins, missing file leaves env unchanged", () => {
    const home = tmp();
    const env = { HOME: home, AUTOLOOP_API_KEY: "real_key" };
    expect(loadAutoloopEnv(env)).toEqual(env); // no ~/.autoloop/env yet
    mkdirSync(join(home, ".autoloop"), { recursive: true });
    writeFileSync(join(home, ".autoloop", "env"), "AUTOLOOP_API_KEY=file_key\nCLAUDE_BIN=/opt/x/claude\n");
    const merged = loadAutoloopEnv(env);
    expect(merged.AUTOLOOP_API_KEY).toBe("real_key");  // real env wins
    expect(merged.CLAUDE_BIN).toBe("/opt/x/claude");   // file fills the gap
    const filled = loadAutoloopEnv({ HOME: home, AUTOLOOP_API_KEY: "" });
    expect(filled.AUTOLOOP_API_KEY).toBe("file_key");  // empty string counts as missing
  });
});

describe("hook session-end", () => {
  const RESUMABLE = { ok: true, state: { loop: { id: "l1", goal: "g", order: 1, status: "running" }, project: { slug: "web", currentLoopId: "l1" }, phases: [], tasks: [], scenarios: [], openBugs: [], pendingMessages: [] } };
  const PAUSED = { ok: true, state: { ...RESUMABLE.state, loop: { ...RESUMABLE.state.loop, status: "paused" } } };

  function setup() {
    const home = tmp(); const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentLoopId: "l1", loops: {}, currentPhaseId: null, currentTaskId: null, phases: {}, tasks: {} });
    const spawned: any[] = [];
    const spawnImpl = (cmd: string, args: string[], opts: any) => { spawned.push({ cmd, args, opts }); return { pid: 999, unref: () => {} }; };
    mkdirSync(join(home, ".autoloop", "run"), { recursive: true }); // tests write the lockfile directly
    return { home, dir, spawned, spawnImpl, lockFile: join(home, ".autoloop", "run", "acme-web.lock"), stampsFile: join(home, ".autoloop", "run", "acme-web.stamps.json") };
  }
  const deps = (s: ReturnType<typeof setup>, over: Record<string, unknown> = {}) => ({
    cwd: s.dir, env: { AUTOLOOP_API_KEY: "al_k", HOME: s.home },
    log: () => {}, err: () => {},
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => RESUMABLE }),
    spawnImpl: s.spawnImpl, isAlive: () => false, psLookup: () => null, now: () => 1_000_000_000,
    ...over,
  });

  it("relaunches the headless driver, releases the lock, stamps the backoff file", async () => {
    const s = setup();
    writeFileSync(s.lockFile, JSON.stringify({ pid: 111 })); // dead (isAlive false)
    expect(await run(["hook", "session-end"], deps(s))).toBe(0);
    expect(s.spawned.length).toBe(1);
    expect(s.spawned[0].cmd).toBe("claude");
    expect(s.spawned[0].args).toEqual(["-p", "/autoloop", "--permission-mode", "acceptEdits"]);
    expect(s.spawned[0].opts).toMatchObject({ cwd: s.dir, detached: true });
    expect(existsSync(s.lockFile)).toBe(false);                                  // released
    expect(JSON.parse(readFileSync(s.stampsFile, "utf8"))).toEqual([1_000_000_000]); // stamped
  });

  it("does NOT relaunch when another LIVE session holds the lock", async () => {
    const s = setup();
    writeFileSync(s.lockFile, JSON.stringify({ pid: 111 }));
    expect(await run(["hook", "session-end"], deps(s, { isAlive: () => true }))).toBe(0);
    expect(s.spawned.length).toBe(0);
    expect(existsSync(s.lockFile)).toBe(true); // someone else's lock — untouched
  });

  it("does NOT relaunch when the loop is paused (loop resume --check semantics)", async () => {
    const s = setup();
    expect(await run(["hook", "session-end"], deps(s, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => PAUSED }) }))).toBe(0);
    expect(s.spawned.length).toBe(0);
  });

  it("stops relaunching when backoff is exceeded (3 stamps in window) and logs it", async () => {
    const s = setup();
    mkdirSync(join(s.home, ".autoloop", "run"), { recursive: true });
    writeFileSync(s.stampsFile, JSON.stringify([999_990_000, 999_980_000, 999_970_000]));
    expect(await run(["hook", "session-end"], deps(s))).toBe(0);
    expect(s.spawned.length).toBe(0);
    expect(readFileSync(join(s.home, ".autoloop", "logs", "hooks.log"), "utf8")).toMatch(/backoff/);
  });

  it("exits 0 quietly when the project is not initialized (hook must never break the session)", async () => {
    const s = setup();
    expect(await run(["hook", "session-end"], deps(s, { cwd: tmp() }))).toBe(0);
    expect(s.spawned.length).toBe(0);
  });
});

describe("hook wake", () => {
  function setup() {
    const home = tmp(); const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentLoopId: "l1", loops: {}, currentPhaseId: null, currentTaskId: null, phases: {}, tasks: {} });
    const spawned: any[] = [];
    const spawnImpl = (cmd: string, args: string[], opts: any) => { spawned.push({ cmd, args, opts }); return { pid: 999, unref: () => {} }; };
    mkdirSync(join(home, ".autoloop", "run"), { recursive: true }); // tests write the lockfile directly
    return { home, dir, spawned, spawnImpl, lockFile: join(home, ".autoloop", "run", "acme-web.lock") };
  }
  // Route the two GETs by URL: …/state → loop status; …/messages → pending list.
  const fetchFor = (loopStatus: string, messages: unknown[]) => async (url: string) => ({
    ok: true, status: 200,
    json: async () => url.endsWith("/messages")
      ? { ok: true, messages }
      : { ok: true, state: { loop: { id: "l1", goal: "g", order: 1, status: loopStatus }, project: { slug: "web", currentLoopId: "l1" }, phases: [], tasks: [], scenarios: [], openBugs: [], pendingMessages: [] } },
  });
  const deps = (s: ReturnType<typeof setup>, fetchImpl: any, over: Record<string, unknown> = {}) => ({
    cwd: s.dir, env: { AUTOLOOP_API_KEY: "al_k", HOME: s.home },
    log: () => {}, err: () => {}, fetchImpl, spawnImpl: s.spawnImpl,
    isAlive: () => false, psLookup: () => null, now: () => 1_000_000_000, ...over,
  });

  it("wakes a paused loop with pending messages and no lock", async () => {
    const s = setup();
    expect(await run(["hook", "wake"], deps(s, fetchFor("paused", [{ id: "m1", text: "go" }])))).toBe(0);
    expect(s.spawned.length).toBe(1);
    expect(s.spawned[0].args).toEqual(["-p", "/autoloop", "--permission-mode", "acceptEdits"]);
    expect(s.spawned[0].opts.cwd).toBe(s.dir); // launchd bakes WorkingDirectory; the shim uses cwd
  });

  it("works with the API key ONLY in ~/.autoloop/env (launchd inherits no shell env) and spawns CLAUDE_BIN", async () => {
    const s = setup();
    writeFileSync(join(s.home, ".autoloop", "env"), "AUTOLOOP_API_KEY=al_k\nCLAUDE_BIN=/opt/x/claude\n");
    // childEnv is seeded from process.env (real env wins) — blank the key so the env-file value is observable
    const realKey = process.env.AUTOLOOP_API_KEY;
    delete process.env.AUTOLOOP_API_KEY;
    try {
      expect(await run(["hook", "wake"], deps(s, fetchFor("paused", [{ id: "m1", text: "go" }]), { env: { HOME: s.home } }))).toBe(0);
    } finally {
      if (realKey !== undefined) process.env.AUTOLOOP_API_KEY = realKey;
    }
    expect(s.spawned.length).toBe(1);
    expect(s.spawned[0].cmd).toBe("/opt/x/claude");                 // absolute path, not bare "claude"
    expect(s.spawned[0].opts.env.AUTOLOOP_API_KEY).toBe("al_k");    // key passed to the headless session
  });

  it("clears a DEAD lock before waking", async () => {
    const s = setup();
    writeFileSync(s.lockFile, JSON.stringify({ pid: 111 })); // dead
    expect(await run(["hook", "wake"], deps(s, fetchFor("paused", [{ id: "m1", text: "go" }])))).toBe(0);
    expect(s.spawned.length).toBe(1);
    expect(existsSync(s.lockFile)).toBe(false);
  });

  it("does NOT wake when a live lock exists / loop not paused / no pending messages", async () => {
    const s = setup();
    writeFileSync(s.lockFile, JSON.stringify({ pid: 111 }));
    await run(["hook", "wake"], deps(s, fetchFor("paused", [{ id: "m1", text: "go" }]), { isAlive: () => true }));
    expect(s.spawned.length).toBe(0);
    rmSync(s.lockFile);
    await run(["hook", "wake"], deps(s, fetchFor("running", [{ id: "m1", text: "go" }])));
    expect(s.spawned.length).toBe(0);
    await run(["hook", "wake"], deps(s, fetchFor("paused", [])));
    expect(s.spawned.length).toBe(0);
  });
});

describe("detectAllowlist / wakePlist (pure)", () => {
  it("always includes autoloop + git; adds detected runners", () => {
    expect(detectAllowlist([])).toEqual(["Bash(autoloop:*)", "Bash(git:*)"]);
    const withNpm = detectAllowlist(["package.json", "src"]);
    expect(withNpm).toContain("Bash(npm:*)");
    expect(withNpm).toContain("Bash(npx:*)");
    expect(detectAllowlist(["Makefile"])).toContain("Bash(make:*)");
    expect(detectAllowlist(["Cargo.toml"])).toContain("Bash(cargo:*)");
    expect(detectAllowlist(["pyproject.toml"])).toContain("Bash(pytest:*)");
  });
  it("wakePlist bakes label, WorkingDirectory, 5-min interval and the hook wake command", () => {
    const xml = wakePlist({ label: "com.autoloop.wake.web", nodePath: "/usr/bin/node", stableCli: "/h/.autoloop/autoloop-cli.mjs", projDir: "/proj", logPath: "/h/.autoloop/logs/web.wake.log" });
    expect(xml).toContain("<string>com.autoloop.wake.web</string>");
    expect(xml).toContain("<key>WorkingDirectory</key><string>/proj</string>");
    expect(xml).toContain("<key>StartInterval</key><integer>300</integer>");
    expect(xml).toContain("<string>hook</string>");
    expect(xml).toContain("<string>wake</string>");
  });
});

describe("init --relaunch / --uninstall / status", () => {
  function setup() {
    const home = tmp(); const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentLoopId: null, loops: {}, currentPhaseId: null, currentTaskId: null, phases: {}, tasks: {} });
    writeFileSync(join(dir, "package.json"), "{}");
    const execs: any[] = [];
    // per-cmd stub: `which claude` resolves; launchctl etc. return nothing
    const execImpl = (cmd: string, args: string[]) => {
      execs.push({ cmd, args });
      return cmd === "which" && args[0] === "claude" ? "/opt/homebrew/bin/claude\n" : "";
    };
    return { home, dir, execs, execImpl,
      settingsPath: join(dir, ".claude", "settings.json"),
      plistPath: join(home, "Library", "LaunchAgents", "com.autoloop.wake.web.plist"),
      lockFile: join(home, ".autoloop", "run", "acme-web.lock"),
      envFile: join(home, ".autoloop", "env") };
  }
  const deps = (s: ReturnType<typeof setup>, over: Record<string, unknown> = {}) => ({
    cwd: s.dir, env: { AUTOLOOP_API_KEY: "al_k", HOME: s.home },
    log: () => {}, err: () => {}, fetchImpl: async () => { throw new Error("no network"); },
    execImpl: s.execImpl, platform: "darwin", ...over,
  });
  const settings = (s: ReturnType<typeof setup>) => JSON.parse(readFileSync(s.settingsPath, "utf8"));

  it("installs the SessionEnd hook, allowlist, plist, stable CLI copy and marker", async () => {
    const s = setup();
    expect(await run(["init", "--relaunch"], deps(s))).toBe(0);
    const st = settings(s);
    expect(st.hooks.SessionEnd.length).toBe(1);
    expect(st.hooks.SessionEnd[0].hooks[0].command).toContain("hook session-end");
    expect(st.permissions.allow).toContain("Bash(autoloop:*)");
    expect(st.permissions.allow).toContain("Bash(git:*)");
    expect(st.permissions.allow).toContain("Bash(npm:*)");           // detected from package.json
    expect(existsSync(join(s.home, ".autoloop", "autoloop-cli.mjs"))).toBe(true);
    const plist = readFileSync(s.plistPath, "utf8");
    expect(plist).toContain(`<key>WorkingDirectory</key><string>${s.dir}</string>`);
    expect(s.execs.some((e) => e.cmd === "launchctl" && e.args[0] === "load")).toBe(true);
    expect(loadConfig(s.dir).relaunch.allowAdded).toContain("Bash(npm:*)");
  });

  it("writes ~/.autoloop/env (0600) with the API key and the resolved claude path", async () => {
    const s = setup();
    expect(await run(["init", "--relaunch"], deps(s))).toBe(0);
    const content = readFileSync(s.envFile, "utf8");
    expect(content).toContain("AUTOLOOP_API_KEY=al_k");
    expect(content).toContain("CLAUDE_BIN=/opt/homebrew/bin/claude");   // via `which claude`
    expect(statSync(s.envFile).mode & 0o777).toBe(0o600);               // holds a secret
  });

  it("is idempotent: re-running adds no duplicate hook or allow entries", async () => {
    const s = setup();
    await run(["init", "--relaunch"], deps(s));
    await run(["init", "--relaunch"], deps(s));
    const st = settings(s);
    expect(st.hooks.SessionEnd.length).toBe(1);
    expect(st.permissions.allow.filter((a: string) => a === "Bash(git:*)").length).toBe(1);
  });

  it("preserves pre-existing user hooks and allow entries", async () => {
    const s = setup();
    mkdirSync(join(s.dir, ".claude"), { recursive: true });
    writeFileSync(s.settingsPath, JSON.stringify({ hooks: { SessionEnd: [{ hooks: [{ type: "command", command: "echo bye" }] }] }, permissions: { allow: ["Bash(curl:*)"] } }));
    await run(["init", "--relaunch"], deps(s));
    const st = settings(s);
    expect(st.hooks.SessionEnd.length).toBe(2);
    expect(st.permissions.allow).toContain("Bash(curl:*)");
  });

  it("status reports relaunchInstalled", async () => {
    const s = setup();
    const logs: string[] = [];
    await run(["status"], deps(s, { log: (m: string) => logs.push(m) }));
    expect(JSON.parse(logs.join(""))).toMatchObject({ teamId: "acme", projectSlug: "web", relaunchInstalled: false });
    await run(["init", "--relaunch"], deps(s));
    logs.length = 0;
    await run(["status"], deps(s, { log: (m: string) => logs.push(m) }));
    expect(JSON.parse(logs.join("")).relaunchInstalled).toBe(true);
  });

  it("--uninstall removes the hook, ONLY the allow entries it added, the plist, the lock and the marker", async () => {
    const s = setup();
    mkdirSync(join(s.dir, ".claude"), { recursive: true });
    writeFileSync(s.settingsPath, JSON.stringify({ permissions: { allow: ["Bash(curl:*)", "Bash(git:*)"] } })); // user already had git
    await run(["init", "--relaunch"], deps(s));
    writeFileSync(s.lockFile, JSON.stringify({ pid: 1 }));
    expect(await run(["init", "--relaunch", "--uninstall"], deps(s))).toBe(0);
    const st = settings(s);
    expect(st.hooks?.SessionEnd ?? []).toEqual([]);
    expect(st.permissions.allow).toContain("Bash(curl:*)");   // user's own — kept
    expect(st.permissions.allow).toContain("Bash(git:*)");    // pre-existing, NOT in allowAdded — kept
    expect(st.permissions.allow).not.toContain("Bash(autoloop:*)");
    expect(existsSync(s.plistPath)).toBe(false);
    expect(existsSync(s.lockFile)).toBe(false);
    expect(existsSync(s.envFile)).toBe(false);                // holds the API key — removed
    expect(loadConfig(s.dir).relaunch).toBeUndefined();
    expect(s.execs.some((e) => e.cmd === "launchctl" && e.args[0] === "unload")).toBe(true);
  });
});
