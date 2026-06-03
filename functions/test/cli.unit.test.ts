import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// @ts-ignore - untyped .mjs imported for runtime test
import { parseArgs, validateStatus, validateId, loadConfig, saveConfig, run } from "../../cli/daloop.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "daloop-")); }

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
  it("saves and loads .daloop.json; loadConfig throws when missing", () => {
    const dir = tmp();
    expect(() => loadConfig(dir)).toThrow(/init/);
    saveConfig(dir, { apiUrl: "u", teamId: "t", projectSlug: "p", currentPhaseId: null, phases: {} });
    expect(loadConfig(dir).teamId).toBe("t");
    expect(JSON.parse(readFileSync(join(dir, ".daloop.json"), "utf8")).projectSlug).toBe("p");
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
  it("writes .daloop.json with team/project/url and empty phase state", async () => {
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
import { report, resolveApiUrl } from "../../cli/daloop.mjs";

describe("resolveApiUrl precedence", () => {
  it("flag > env > config", () => {
    expect(resolveApiUrl({ apiUrl: "c" }, { DALOOP_API_URL: "e" }, "f")).toBe("f");
    expect(resolveApiUrl({ apiUrl: "c" }, { DALOOP_API_URL: "e" }, undefined)).toBe("e");
    expect(resolveApiUrl({ apiUrl: "c" }, {}, undefined)).toBe("c");
  });
});

describe("report (exit policy)", () => {
  const okFetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }), text: async () => "" });
  function failFetch(status: number, body: any) {
    return async () => ({ ok: false, status, json: async () => body, text: async () => JSON.stringify(body) });
  }
  const base = { cwd: "/", env: { DALOOP_API_KEY: "dl_k" }, log: () => {}, err: () => {} };

  it("throws UsageError when DALOOP_API_KEY missing (before network)", async () => {
    await expect(report({ method: "PUT", url: "http://x/v1", body: {} }, { ...base, env: {} })).rejects.toThrow(/DALOOP_API_KEY/);
  });

  it("returns 0 on success and sends Bearer auth + JSON body", async () => {
    let captured: any;
    const code = await report({ method: "PUT", url: "http://x/v1/teams/t/projects/p", body: { title: "x" } },
      { ...base, fetchImpl: async (url: string, init: any) => { captured = { url, init }; return okFetch(); } });
    expect(code).toBe(0);
    expect(captured.init.method).toBe("PUT");
    expect(captured.init.headers.Authorization).toBe("Bearer dl_k");
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

  it("phase start records name/order + currentPhaseId and PUTs running", async () => {
    const dir = initDir();
    const code = await run(["phase", "start", "build", "--name", "Build", "--order", "1"],
      { cwd: dir, env: { DALOOP_API_KEY: "dl_k" }, log: () => {}, err: () => {}, fetchImpl: okFetch });
    expect(code).toBe(0);
    expect((okFetch as any).last.url).toBe("http://api/v1/teams/acme/projects/web/phases/build");
    expect(JSON.parse((okFetch as any).last.init.body)).toMatchObject({ name: "Build", order: 1, status: "running" });
    const cfg = loadConfig(dir);
    expect(cfg.currentPhaseId).toBe("build");
    expect(cfg.phases.build).toEqual({ name: "Build", order: 1 });
  });

  it("phase set re-sends recorded name/order + new status", async () => {
    const dir = initDir();
    await run(["phase", "start", "build", "--name", "Build", "--order", "1"], { cwd: dir, env: { DALOOP_API_KEY: "dl_k" }, log: () => {}, err: () => {}, fetchImpl: okFetch });
    await run(["phase", "set", "build", "--status", "completed"], { cwd: dir, env: { DALOOP_API_KEY: "dl_k" }, log: () => {}, err: () => {}, fetchImpl: okFetch });
    expect(JSON.parse((okFetch as any).last.init.body)).toMatchObject({ name: "Build", order: 1, status: "completed" });
  });

  it("phase set on an unstarted id -> exit 1, no network", async () => {
    const errs: string[] = [];
    const code = await run(["phase", "set", "ghost", "--status", "completed"],
      { cwd: initDir(), env: { DALOOP_API_KEY: "dl_k" }, log: () => {}, err: (m: string) => errs.push(m), fetchImpl: async () => { throw new Error("no"); } });
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
      { cwd: dir, env: { DALOOP_API_KEY: "dl_k" }, log: () => {}, err: () => {},
        fetchImpl: async (url: string, init: any) => { captured = { url, init }; return { ok: true, status: 200, json: async () => ({}) }; } });
    expect(code).toBe(0);
    expect(captured.url).toBe("http://api/v1/teams/acme/projects/web");
    const body = JSON.parse(captured.init.body);
    expect(body).toMatchObject({ title: "Web", status: "running", design: { format: "markdown", content: "# Plan" } });
  });
  it("returns 1 (no crash) when --design-file is missing", async () => {
    const errs: string[] = [];
    const code = await run(["project", "set", "--title", "Web", "--status", "running", "--design-file", "nope.md"],
      { cwd: initDir(), env: { DALOOP_API_KEY: "dl_k" }, log: () => {}, err: (m: string) => errs.push(m),
        fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).toBe(1);
    expect(errs.join(" ")).toMatch(/could not read --design-file/);
  });
  it("rejects an invalid status (exit 1, no network)", async () => {
    const errs: string[] = [];
    const code = await run(["project", "set", "--title", "Web", "--status", "nope"],
      { cwd: initDir(), env: { DALOOP_API_KEY: "dl_k" }, log: () => {}, err: (m: string) => errs.push(m),
        fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).toBe(1);
    expect(errs.join(" ")).toMatch(/invalid status/);
  });
});

// @ts-ignore
import { parseGitHead } from "../../cli/daloop.mjs";

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
    const code = await run(["commit"], { cwd: dir, env: { DALOOP_API_KEY: "dl_k" }, log: () => {}, err: () => {}, gitRun, fetchImpl });
    expect(code).toBe(0);
    expect(calls[0].url).toBe("http://api/v1/teams/acme/projects/web/tasks/main"); // implicit task created
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ phaseId: "build", title: "Main", order: 0, status: "running", scenarioIds: [] });
    expect(calls[1].url).toBe("http://api/v1/teams/acme/projects/web/tasks/main/commits/deadbeef");
    expect(loadConfig(dir).currentTaskId).toBe("main");
  });

  it("uses --task when given (no implicit task)", async () => {
    const dir = initDir(); let captured: any;
    const code = await run(["commit", "--task", "t7"], { cwd: dir, env: { DALOOP_API_KEY: "dl_k" }, log: () => {}, err: () => {}, gitRun,
      fetchImpl: async (url: string, init: any) => { captured = { url, init }; return { ok: true, status: 200, json: async () => ({}) }; } });
    expect(code).toBe(0);
    expect(captured.url).toBe("http://api/v1/teams/acme/projects/web/tasks/t7/commits/deadbeef");
  });

  it("uses currentTaskId when set (no implicit task)", async () => {
    const dir = initDir("t3"); const calls: any[] = [];
    await run(["commit"], { cwd: dir, env: { DALOOP_API_KEY: "dl_k" }, log: () => {}, err: () => {}, gitRun,
      fetchImpl: async (url: string, init: any) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({}) }; } });
    expect(calls).toHaveLength(1); // no implicit-task PUT
    expect(calls[0].url).toBe("http://api/v1/teams/acme/projects/web/tasks/t3/commits/deadbeef");
  });

  it("exits 1 when no currentPhaseId and no task can be resolved", async () => {
    const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentPhaseId: null, currentTaskId: null, phases: {}, tasks: {} });
    const errs: string[] = [];
    const code = await run(["commit"], { cwd: dir, env: { DALOOP_API_KEY: "dl_k" }, log: () => {}, err: (m: string) => errs.push(m), gitRun, fetchImpl: async () => { throw new Error("no"); } });
    expect(code).toBe(1);
    expect(errs.join(" ")).toMatch(/no current phase/i);
  });

  it("exits 1 when git author is empty", async () => {
    const errs: string[] = [];
    const code = await run(["commit", "--task", "t1"], { cwd: initDir(), env: { DALOOP_API_KEY: "dl_k" }, log: () => {}, err: (m: string) => errs.push(m),
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
  const base = (dir: string, c: any) => ({ cwd: dir, env: { DALOOP_API_KEY: "dl_k" }, log: () => {}, err: () => {}, fetchImpl: c.fetchImpl });

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
    expect(JSON.parse(c.init.body)).toMatchObject({ phaseId: "p1", title: "Build", order: 1, status: "running", scenarioIds: ["s1", "s2"] });
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
});

describe("event + vision verbs (request shapes)", () => {
  function initDir() {
    const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentPhaseId: "p1", currentTaskId: "t1", phases: {}, tasks: {} });
    return dir;
  }
  const cap = () => { const c: any = { calls: [] }; c.fetchImpl = async (url: string, init: any) => { c.calls.push({ url, init }); c.url = url; c.init = init; return { ok: true, status: 200, json: async () => ({ ok: true, id: "01XYZ" }) }; }; return c; };
  const base = (dir: string, c: any) => ({ cwd: dir, env: { DALOOP_API_KEY: "dl_k" }, log: () => {}, err: () => {}, fetchImpl: c.fetchImpl });

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
});
