import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// @ts-ignore - untyped .mjs imported for runtime test
import { parseArgs, validateStatus, validateId, loadConfig, saveConfig, run, firstNonTerminalTask, isResumable } from "../../cli/autoloop.mjs";

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
