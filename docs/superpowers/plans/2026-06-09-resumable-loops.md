# Durable, resumable loops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a mid-flight loop survive the Claude Code session. **Phase 1 (resume):** a `GET …/state` aggregated state bundle (server), `autoloop loop resume` (CLI), and a Step 0 Resume check in the driver skill so a fresh session reconstructs position from the server. **Phase 2 (relaunch):** `autoloop init --relaunch` installs host-side machinery — a project lockfile, a SessionEnd hook that relaunches a headless session when the loop is still non-terminal, and a launchd 5-min wake job that brings a *paused* loop back up when a dashboard message arrives — replacing the token-burning Step 4 sleep-poll with an external wake.

**Architecture:** Phase 1 is a pure read: one new service `getLoopState` (parallel reads via `resolveBase`, reusing `listPendingUserMessages`), one router mounted both loop-scoped (`…/loops/:loopId/state`) and project-direct (`…/state`), no schema or rules change. Phase 2 is entirely client/host-side, mirroring `installSessionLogHook`'s idempotent versioned-entry pattern, with a deliberate new home `~/.autoloop/` (stable CLI copy + `run/` + `logs/`; the session-log hook's `~/.claude/autoloop-cli.mjs` copy stays put and converges later). Hook shims are CLI verbs (`hook session-end`, `hook wake`) run from the stable copy; their decision logic is pure, exported functions with unit tests — only the OS wiring (launchd/SessionEnd) is verified by the documented manual checklist.

**Tech Stack:** Firebase Cloud Functions v2 (TypeScript, Firestore Admin SDK), Express routers, Vitest + Firestore emulator + Supertest, dependency-free Node CLI (`cli/autoloop.mjs`), Claude Code hooks (project `.claude/settings.json`), launchd (macOS) / documented crontab (Linux).

**Spec:** `docs/superpowers/specs/2026-06-09-resumable-loops-design.md` — approved twice; implement exactly, no redesign.

**Conventions (read before starting):**
- Run a single functions test file with the emulator already running (`cd functions && npm run emulators` in another terminal): `cd functions && npm run test:run -- <name>`. `cli.unit` needs **no** emulator. The full suite (spins up the emulator itself) is `cd functions && npm test`. Rules tests: `cd functions && npm run test:rules`.
- Commit messages end with the trailer:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- The CLI has **three copies**: canonical `cli/autoloop.mjs` → `plugins/autoloop/bin/autoloop` + `web/public/skill/autoloop.mjs`, synced by `bash scripts/sync-autoloop-cli.sh` (which also syncs `plugins/autoloop/skills/autoloop/SKILL.md` → `web/public/skill/autoloop/SKILL.md`). Run it after every CLI or SKILL.md change and commit the generated copies.
- Skill changes bump `plugins/autoloop/.claude-plugin/plugin.json` `version` (currently `0.10.1`): Phase 1 → `0.11.0`, Phase 2 → `0.12.0`.
- Spec-ambiguity resolutions baked into this plan (do not re-litigate mid-implementation): the back-compat marker is reported by a new minimal `autoloop status` verb (the spec names it; it does not exist today); `lock acquire`/`lock release` are invoked by the driver skill (Step 0 / Step 3b) when relaunch is installed; `loop resume --check` exits 1 for project-direct (loop-less) projects (`state.loop` is null — literal reading); backoff blocks the 4th relaunch in a rolling 30-min window; `messages pull --check` is silent and any failure exits 1; `init --relaunch` works on an already-initialized dir without `--team`; `lock release` deletes unconditionally; scenarios are sorted in memory by `order`-then-id (Firestore `orderBy` would drop docs missing the optional `order` field); the relaunch stamp file is `~/.autoloop/run/<teamId>-<slug>.stamps.json` (JSON array of ms timestamps).

---

## Phase 1 — resume

### Task 1: `getLoopState` service

**Files:**
- Create: `functions/src/services/loopState.ts`
- Test: `functions/test/loopState.test.ts` (new)

- [ ] **Step 1: Write the failing service tests**

`functions/test/loopState.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import "./helpers.js";
import { authHeader, seedMember } from "./helpers.js";
import { makeApp } from "../src/app.js";
import { db } from "../src/firestore.js";
import { Timestamp } from "firebase-admin/firestore";
import { getLoopState } from "../src/services/loopState.js";
import { createMessage } from "../src/services/messages.js";

const app = makeApp();
const rubric = { criteria: [{ id: "correctness", name: "C", weight: 1, max: 5 }] };

async function seedTeam(teamId = "team1") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
  await seedMember(teamId);
}
async function createProject(slug = "acme") {
  await seedTeam();
  await request(app).put(`/v1/teams/team1/projects/${slug}`).set(authHeader()).send({ title: "Acme", status: "running" });
}
const put = (path: string, body: Record<string, unknown>) =>
  request(app).put(`/v1/teams/team1/projects/acme${path}`).set(authHeader()).send(body);

/** Full fixture: loop l1 with 2 phases / 3 tasks (seeded out of order), 2 scenarios,
 *  1 open + 1 fixed bug, 1 pending message. */
async function seedLoopFixture() {
  await createProject();
  await put("/scenarios/s1", { goalId: "g1", title: "S1", threshold: 80, rubric, order: 1 });
  await put("/scenarios/s2", { goalId: "g1", title: "S2", rubric }); // no order, no threshold
  await put("/loops/l1", { goal: "ship it", name: "Loop 1", order: 1, status: "running" });
  await put("/loops/l1/phases/p2", { name: "Polish", order: 2, status: "queued" });
  await put("/loops/l1/phases/p1", { name: "Build", order: 1, status: "running" });
  await put("/loops/l1/tasks/t3", { phaseId: "p2", title: "T3", order: 1, status: "queued", scenarioIds: ["s2"] });
  await put("/loops/l1/tasks/t2", { phaseId: "p1", title: "T2", order: 2, status: "running", scenarioIds: ["s1"] });
  await put("/loops/l1/tasks/t1", { phaseId: "p1", title: "T1", order: 1, status: "completed", scenarioIds: ["s1"] });
  await put("/loops/l1/bugs/b1", { title: "Open bug", status: "open", severity: "high", scenarioId: "s1", taskId: "t1" });
  await put("/loops/l1/bugs/b2", { title: "Fixed bug", status: "fixed" });
  await createMessage("team1", "acme", "first msg", "user", "u1");
}

describe("getLoopState (service)", () => {
  it("returns the loop-scoped bundle: loop doc, ordered phases/tasks, project-level scenarios, open bugs, pending messages", async () => {
    await seedLoopFixture();
    const s = await getLoopState("team1", "acme", "l1");

    expect(s.loop).toMatchObject({ id: "l1", goal: "ship it", name: "Loop 1", order: 1, status: "running" });
    expect((s.loop as Record<string, unknown>).currentPhaseId).toBe("p1");
    expect((s.loop as Record<string, unknown>).currentTaskId).toBe("t2");
    expect(s.project).toMatchObject({ slug: "acme", title: "Acme", status: "running", currentLoopId: "l1" });

    expect(s.phases.map((p) => p.id)).toEqual(["p1", "p2"]);            // by order
    expect(s.tasks.map((t) => t.id)).toEqual(["t1", "t3", "t2"]);       // by task order (1,1,2)
    expect(s.tasks[0]).toMatchObject({ phaseId: "p1", title: "T1", order: 1, status: "completed", scenarioIds: ["s1"] });

    expect(s.scenarios.map((x) => x.id)).toEqual(["s1", "s2"]);         // order asc, missing-order last
    expect(s.scenarios[0]).toMatchObject({ goalId: "g1", title: "S1", threshold: 80 });

    expect(s.openBugs.length).toBe(1);                                  // fixed bug filtered out
    expect(s.openBugs[0]).toMatchObject({ id: "b1", title: "Open bug", severity: "high", scenarioId: "s1", taskId: "t1" });

    expect(s.pendingMessages.length).toBe(1);
    expect(s.pendingMessages[0].text).toBe("first msg");
  });

  it("returns pendingMessages oldest-first", async () => {
    await createProject();
    await createMessage("team1", "acme", "older", "user", "u1");
    await createMessage("team1", "acme", "newer", "user", "u1");
    const s = await getLoopState("team1", "acme");
    expect(s.pendingMessages.map((m) => m.text)).toEqual(["older", "newer"]);
  });

  it("project-direct: loop is null and phases/tasks come from the project root", async () => {
    await createProject();
    await put("/phases/p1", { name: "Build", order: 1, status: "running" });
    await put("/tasks/t1", { phaseId: "p1", title: "T1", order: 1, status: "running" });
    const s = await getLoopState("team1", "acme");
    expect(s.loop).toBeNull();
    expect(s.phases.map((p) => p.id)).toEqual(["p1"]);
    expect(s.tasks.map((t) => t.id)).toEqual(["t1"]);
  });

  it("attaches latestComposite + latestTestRun per scenario from LOOP-scoped events only", async () => {
    await seedLoopFixture();
    // project-direct events must NOT leak into the loop-scoped bundle
    await db().doc("teams/team1/projects/acme/scores/01PROJDIRECT").set(
      { scenarioId: "s1", taskId: "t1", criteria: {}, composite: 11, createdAt: Timestamp.now() });
    await request(app).post("/v1/teams/team1/projects/acme/loops/l1/scores").set(authHeader())
      .send({ scenarioId: "s1", taskId: "t1", criteria: { correctness: 4 }, composite: 85 });
    await request(app).post("/v1/teams/team1/projects/acme/loops/l1/testRuns").set(authHeader())
      .send({ scenarioId: "s1", taskId: "t1", passed: 7, failed: 1 });

    const s = await getLoopState("team1", "acme", "l1");
    const s1 = s.scenarios.find((x) => x.id === "s1")!;
    expect(s1.latestComposite).toBe(85);
    expect(s1.latestTestRun).toEqual({ passed: 7, failed: 1 });
    const s2 = s.scenarios.find((x) => x.id === "s2")!;
    expect(s2.latestComposite).toBeUndefined();
    expect(s2.latestTestRun).toBeUndefined();
  });

  it("selects the latest event by ULID id, NOT by createdAt timestamp", async () => {
    await seedLoopFixture();
    const base = "teams/team1/projects/acme/loops/l1";
    // lexically LATER id carries an OLDER createdAt — id must win
    await db().doc(`${base}/scores/01AAAAAAAAAAAAAAAAAAAAAAAA`).set(
      { scenarioId: "s1", taskId: "t1", criteria: {}, composite: 50, createdAt: Timestamp.fromDate(new Date("2026-06-09T12:00:00Z")) });
    await db().doc(`${base}/scores/01BBBBBBBBBBBBBBBBBBBBBBBB`).set(
      { scenarioId: "s1", taskId: "t1", criteria: {}, composite: 90, createdAt: Timestamp.fromDate(new Date("2026-06-01T00:00:00Z")) });
    const s = await getLoopState("team1", "acme", "l1");
    expect(s.scenarios.find((x) => x.id === "s1")!.latestComposite).toBe(90);
  });

  it("404s on a missing project and a missing loop", async () => {
    await seedTeam();
    await expect(getLoopState("team1", "ghost")).rejects.toMatchObject({ httpStatus: 404 });
    await createProject();
    await expect(getLoopState("team1", "acme", "ghost")).rejects.toMatchObject({ httpStatus: 404 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- loopState`
Expected: FAIL (`services/loopState.js` does not exist).

- [ ] **Step 3: Implement**

`functions/src/services/loopState.ts`:

```ts
import { resolveBase } from "./baseRef.js";
import { listPendingUserMessages, type MessagePreview } from "./messages.js";

type Ref = FirebaseFirestore.DocumentReference;
type DocSnap = FirebaseFirestore.QueryDocumentSnapshot;

export interface LoopState {
  loop: Record<string, unknown> | null;       // null project-direct
  project: Record<string, unknown>;
  phases: Array<Record<string, unknown>>;     // ordered by order
  tasks: Array<Record<string, unknown>>;      // ordered by order
  scenarios: Array<Record<string, unknown>>;  // project-level vision; latest events loop-scoped
  openBugs: Array<Record<string, unknown>>;
  pendingMessages: MessagePreview[];          // project-level, oldest-first
}

/** Copy only the defined keys (omitted fields stay omitted in the bundle). */
function pick(src: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

/** Latest event for a scenario: order by document id (ULID — lexically time-sortable),
 *  NOT createdAt. Equality filter + __name__ order needs no composite index. */
async function latestEvent(baseRef: Ref, coll: "scores" | "testRuns", scenarioId: string) {
  const snap = await baseRef.collection(coll)
    .where("scenarioId", "==", scenarioId)
    .orderBy("__name__", "desc")
    .limit(1)
    .get();
  return snap.empty ? undefined : snap.docs[0].data();
}

/**
 * Aggregated resume bundle (Phase 1 of resumable loops). Pure read: parallel reads of the
 * base-path collections (loop-scoped via resolveBase, else project-direct), project-level
 * scenarios + pending messages (reusing the messages service), and per-scenario latest
 * score/testRun (N+1 limit-1 queries — scenario count is small; consistent with the
 * no-composite-indexes stance).
 */
export async function getLoopState(teamId: string, slug: string, loopId?: string): Promise<LoopState> {
  const { projectRef, baseRef } = await resolveBase(teamId, slug, loopId); // 404s project/loop
  const [loopSnap, projectSnap, phasesSnap, tasksSnap, scenariosSnap, bugsSnap, pendingMessages] = await Promise.all([
    loopId ? baseRef.get() : Promise.resolve(undefined),
    projectRef.get(),
    baseRef.collection("phases").orderBy("order").get(),
    baseRef.collection("tasks").orderBy("order").get(),
    // plain get: scenario `order` is optional and Firestore orderBy() DROPS docs missing the field
    projectRef.collection("scenarios").get(),
    baseRef.collection("bugs").where("status", "==", "open").get(),
    listPendingUserMessages(teamId, slug),
  ]);

  const project = { slug, ...pick(projectSnap.data()!, ["title", "status", "currentLoopId"]) };
  const loop = loopId && loopSnap?.exists
    ? { id: loopId, ...pick(loopSnap.data()!, ["goal", "name", "order", "status", "currentPhaseId", "currentTaskId"]) }
    : null;
  const phases = phasesSnap.docs.map((d) => ({ id: d.id, ...pick(d.data(), ["name", "order", "status"]) }));
  const tasks = tasksSnap.docs.map((d) => ({ id: d.id, scenarioIds: d.data().scenarioIds ?? [], ...pick(d.data(), ["phaseId", "title", "order", "status"]) }));
  const openBugs = bugsSnap.docs.map((d) => ({ id: d.id, ...pick(d.data(), ["title", "severity", "scenarioId", "taskId"]) }));

  const orderOf = (d: DocSnap) => (d.data().order as number | undefined) ?? Number.POSITIVE_INFINITY;
  const scenarioDocs = [...scenariosSnap.docs].sort((a, b) => orderOf(a) - orderOf(b) || a.id.localeCompare(b.id));
  const scenarios = await Promise.all(scenarioDocs.map(async (d) => {
    const [score, testRun] = await Promise.all([
      latestEvent(baseRef, "scores", d.id),
      latestEvent(baseRef, "testRuns", d.id),
    ]);
    const s: Record<string, unknown> = { id: d.id, ...pick(d.data(), ["goalId", "title", "threshold"]) };
    if (score) s.latestComposite = score.composite;
    if (testRun) s.latestTestRun = { passed: testRun.passed, failed: testRun.failed };
    return s;
  }));

  return { loop, project, phases, tasks, scenarios, openBugs, pendingMessages };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- loopState`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/loopState.ts functions/test/loopState.test.ts
git commit -m "feat(state): getLoopState aggregated resume bundle service

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: State router + dual mounts + API tests

**Files:**
- Create: `functions/src/routes/loopState.ts`
- Modify: `functions/src/app.ts` (import + two mounts)
- Test: extend `functions/test/loopState.test.ts`

- [ ] **Step 1: Write the failing API tests**

Append to `functions/test/loopState.test.ts`:

```ts
describe("GET state (API)", () => {
  it("loop-scoped: 200 { ok, state } with the loop populated", async () => {
    await seedLoopFixture();
    const res = await request(app).get("/v1/teams/team1/projects/acme/loops/l1/state").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.state.loop).toMatchObject({ id: "l1", status: "running" });
    expect(res.body.state.phases.map((p: { id: string }) => p.id)).toEqual(["p1", "p2"]);
    expect(res.body.state.pendingMessages.length).toBe(1);
  });

  it("project-direct: 200 with state.loop null and project.currentLoopId passthrough", async () => {
    await seedLoopFixture(); // loop exists, but we hit the project-direct route
    const res = await request(app).get("/v1/teams/team1/projects/acme/state").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.state.loop).toBeNull();
    expect(res.body.state.project.currentLoopId).toBe("l1");
  });

  it("401s without an API key", async () => {
    await seedLoopFixture();
    expect((await request(app).get("/v1/teams/team1/projects/acme/loops/l1/state")).status).toBe(401);
    expect((await request(app).get("/v1/teams/team1/projects/acme/state")).status).toBe(401);
  });

  it("404s on a missing loop and a missing project", async () => {
    await createProject();
    expect((await request(app).get("/v1/teams/team1/projects/acme/loops/ghost/state").set(authHeader())).status).toBe(404);
    expect((await request(app).get("/v1/teams/team1/projects/ghost/state").set(authHeader())).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- loopState`
Expected: FAIL (the new API tests 404 — no mount yet).

- [ ] **Step 3: Implement the router**

`functions/src/routes/loopState.ts`:

```ts
import { Router } from "express";
import { idPattern } from "../schemas.js";
import { AppError } from "../errors.js";
import { getLoopState } from "../services/loopState.js";

export const stateRouter = Router({ mergeParams: true }); // agent read (API key)

stateRouter.get("/", async (req, res, next) => {
  try {
    const { teamId, slug, loopId } = req.params as { teamId: string; slug: string; loopId?: string };
    if (!idPattern.test(teamId) || !idPattern.test(slug)) throw new AppError(400, "validation", "invalid teamId/slug");
    if (loopId !== undefined && !idPattern.test(loopId)) throw new AppError(400, "validation", "invalid loopId");
    const state = await getLoopState(teamId, slug, loopId);
    res.status(200).json({ ok: true, state });
  } catch (err) { next(err); }
});
```

- [ ] **Step 4: Mount in `app.ts`**

Add the import next to the other route imports:

```ts
import { stateRouter } from "./routes/loopState.js";
```

Add the **project-direct** mount immediately after `teamRouter.use("/:slug/messages", messagesRouter);`:

```ts
  teamRouter.use("/:slug/state", stateRouter);
```

Add the **loop-scoped** mount with the other `…/loops/:loopId/*` mounts (immediately after `teamRouter.use("/:slug/loops/:loopId/sessions", sessionsRouter);`, i.e. BEFORE `teamRouter.use("/:slug/loops", loopsRouter);`):

```ts
  teamRouter.use("/:slug/loops/:loopId/state", stateRouter);
```

- [ ] **Step 5: Run to verify it passes, then build**

Run: `cd functions && npm run test:run -- loopState && npm run build`
Expected: PASS; build clean.

- [ ] **Step 6: Commit**

```bash
git add functions/src/routes/loopState.ts functions/src/app.ts functions/test/loopState.test.ts
git commit -m "feat(state): GET state routes — loop-scoped + project-direct mounts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: CLI `loop resume [loopId]` (+ `--check`)

**Files:**
- Modify: `cli/autoloop.mjs` (hoist `TERMINAL_STATUSES`; add `getJson`, `fetchResumeState`, `firstNonTerminalTask`, `resumeHeader`, `isResumable`; add the `loop resume` case after `loop set`)
- Test: `functions/test/cli.unit.test.ts` (new describe block)

- [ ] **Step 1: Write the failing tests**

Add to `functions/test/cli.unit.test.ts` (also extend the existing CLI import line with `firstNonTerminalTask, isResumable`):

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: FAIL (`loop resume` unknown command; `firstNonTerminalTask` not exported).

- [ ] **Step 3: Implement**

In `cli/autoloop.mjs`:

(a) Hoist the terminal set to module scope (after the `STATUSES` export) and update the `loop set` case to use it (delete its local `const TERMINAL_STATUSES = …` line):

```js
export const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];
```

(b) Add after `fetchJson`:

```js
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
    const res = await fetchImpl(url, { method: "GET", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` } });
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
```

(c) Add the dispatch case after `case "loop set"`:

```js
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: PASS (including all pre-existing CLI tests — the `TERMINAL_STATUSES` hoist must not regress `loop set`).

- [ ] **Step 5: Commit**

```bash
git add cli/autoloop.mjs functions/test/cli.unit.test.ts
git commit -m "feat(cli): loop resume [loopId] — state bundle + --check exit contract

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: CLI `messages pull --check`

**Files:**
- Modify: `cli/autoloop.mjs` (`messages pull` case)
- Test: `functions/test/cli.unit.test.ts` (extend the "messages pull/ack/send verbs" block)

- [ ] **Step 1: Write the failing tests**

Add to the existing `describe("messages pull/ack/send verbs", …)` block:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: FAIL (`--check` ignored — plain pull prints and exits 0 regardless).

- [ ] **Step 3: Implement**

Replace the `messages pull` case body:

```js
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/autoloop.mjs functions/test/cli.unit.test.ts
git commit -m "feat(cli): messages pull --check (silent pending probe, no ack)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Driver skill Step 0 (Resume check) + Phase-1 sync + plugin bump

**Files:**
- Modify: `plugins/autoloop/skills/autoloop/SKILL.md` (insert Step 0 between Preconditions and Step 1)
- Modify: `plugins/autoloop/.claude-plugin/plugin.json` (version `0.10.1` → `0.11.0`)
- Modify (generated): `plugins/autoloop/bin/autoloop`, `web/public/skill/autoloop.mjs`, `web/public/skill/autoloop/SKILL.md` (via the sync script)

- [ ] **Step 1: Insert Step 0 in the skill**

In `plugins/autoloop/skills/autoloop/SKILL.md`, insert between the `## Preconditions` section and `## Step 1 — Setup (once per run)`:

```markdown
## Step 0 — Resume check (before ANY setup)

If `.autoloop.json` exists, ask the server whether a loop is already mid-flight
BEFORE doing any setup:

```bash
autoloop loop resume    # human header + the full state bundle as pretty JSON
```

If the state shows a **non-terminal loop** (`state.loop.status` is not
completed/failed/cancelled):

- **Skip Step 1 entirely** — no `vision import`, no `project set`, no new
  `loop start`. The plan already lives on the server; re-running setup would
  clobber it.
- **Rebuild the working plan from `state`**: `state.phases` + `state.tasks`
  carry `order` and `status`. The next task is the **first non-terminal task by
  phase order, then task order** — the header names it (`next: …`).
- **Drain `state.pendingMessages` FIRST** (they are oldest-first): act on each,
  then `autoloop messages ack <id>`. A message may change scope or direction —
  honor it before picking up the next task.
- Then continue the normal **Step 2** per-task loop from that next task
  (re-run `autoloop init --session-log` so the session-log hook points at this
  session).
- If `state.loop.status` is `paused`: resume into **Step 4 (Paused)** instead —
  unless a pending message says to resume or change course, in which case do
  what it says.

If there is no non-terminal loop (the CLI prints `no active loop`), proceed to
Step 1 as normal.
```

- [ ] **Step 2: Bump the plugin version**

In `plugins/autoloop/.claude-plugin/plugin.json`: `"version": "0.10.1"` → `"version": "0.11.0"`.

- [ ] **Step 3: Sync the copies and verify they are identical**

Run: `bash scripts/sync-autoloop-cli.sh`
Expected: the `✓ synced …` lines.

Run: `diff cli/autoloop.mjs plugins/autoloop/bin/autoloop && diff cli/autoloop.mjs web/public/skill/autoloop.mjs && diff plugins/autoloop/skills/autoloop/SKILL.md web/public/skill/autoloop/SKILL.md && echo IDENTICAL`
Expected: `IDENTICAL`.

- [ ] **Step 4: Skill-vs-CLI prose check**

Verify every command named in the new Step 0 exists in the CLI: `loop resume`, `messages ack`, `init --session-log` (driver-hygiene review rule). `grep -n "loop resume" cli/autoloop.mjs` must hit the dispatch case.

- [ ] **Step 5: Commit**

```bash
git add plugins/autoloop/skills/autoloop/SKILL.md plugins/autoloop/.claude-plugin/plugin.json plugins/autoloop/bin/autoloop web/public/skill/autoloop.mjs web/public/skill/autoloop/SKILL.md
git commit -m "feat(skill): Step 0 resume check — rebuild a mid-flight loop from the server (0.11.0)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Phase 1 is complete and shippable at this point.**

---

## Phase 2 — relaunch machinery

### Task 6: `~/.autoloop` home + lock primitives + `lock acquire`/`lock release`

**Files:**
- Modify: `cli/autoloop.mjs` (imports; home/lock helpers; `lock acquire` + `lock release` cases; new injectable deps `psLookup`/`isAlive` in `run`)
- Test: `functions/test/cli.unit.test.ts` (new describe blocks)

- [ ] **Step 1: Write the failing tests**

Add to `functions/test/cli.unit.test.ts` (extend the CLI import line with `findClaudeSessionPid, evaluateLock`; `existsSync` from `node:fs`):

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: FAIL (functions not exported; `lock acquire` unknown command).

- [ ] **Step 3: Implement**

In `cli/autoloop.mjs`:

(a) Extend the `node:fs` import with `rmSync, openSync` and the `node:child_process` import with `spawn`.

(b) Add after `installSessionLogHook` (Phase-2 home + lock helpers):

```js
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
```

(c) In `run`, extend the destructured deps:

```js
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
```

(d) Add the dispatch cases (after `loop resume`):

```js
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/autoloop.mjs functions/test/cli.unit.test.ts
git commit -m "feat(cli): lock acquire/release — claude-session pid lockfile under ~/.autoloop/run

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Backoff guard + pure relaunch decisions + headless launcher

**Files:**
- Modify: `cli/autoloop.mjs` (stamps, `backoffExceeded`, `decideSessionEndRelaunch`, `decideWake`, `launchHeadless`)
- Test: `functions/test/cli.unit.test.ts`

- [ ] **Step 1: Write the failing tests**

Add (extend the CLI import line with `backoffExceeded, decideSessionEndRelaunch, decideWake`):

```ts
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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: FAIL (not exported).

- [ ] **Step 3: Implement**

Add to `cli/autoloop.mjs` after `evaluateLock`:

```js
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
  const child = spawnImpl("claude", ["-p", "/autoloop", "--permission-mode", "acceptEdits"],
    { cwd, detached: true, stdio: ["ignore", out, out] });
  child.unref?.();
  log(`autoloop: relaunched headless driver (pid ${child.pid ?? "?"}) — log: ${logFile}`);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/autoloop.mjs functions/test/cli.unit.test.ts
git commit -m "feat(cli): relaunch backoff guard + pure session-end/wake decisions + headless launcher

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: `hook session-end` shim

**Files:**
- Modify: `cli/autoloop.mjs` (`hook session-end` case + shared `hookLog` helper)
- Test: `functions/test/cli.unit.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("hook session-end", () => {
  const RESUMABLE = { ok: true, state: { loop: { id: "l1", goal: "g", order: 1, status: "running" }, project: { slug: "web", currentLoopId: "l1" }, phases: [], tasks: [], scenarios: [], openBugs: [], pendingMessages: [] } };
  const PAUSED = { ok: true, state: { ...RESUMABLE.state, loop: { ...RESUMABLE.state.loop, status: "paused" } } };

  function setup() {
    const home = tmp(); const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentLoopId: "l1", loops: {}, currentPhaseId: null, currentTaskId: null, phases: {}, tasks: {} });
    const spawned: any[] = [];
    const spawnImpl = (cmd: string, args: string[], opts: any) => { spawned.push({ cmd, args, opts }); return { pid: 999, unref: () => {} }; };
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
```

> `mkdirSync` needs adding to the `node:fs` import at the top of `cli.unit.test.ts` if not already there.

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: FAIL (`hook session-end` unknown command).

- [ ] **Step 3: Implement**

(a) Add a shared shim logger near `launchHeadless`:

```js
/** Append one line to ~/.autoloop/logs/hooks.log — diagnosable, never fails the hook. */
export function hookLog(env, tag, msg, nowMs = Date.now()) {
  try {
    mkdirSync(join(autoloopHome(env), "logs"), { recursive: true });
    writeFileSync(join(autoloopHome(env), "logs", "hooks.log"),
      `[${new Date(nowMs).toISOString()}] ${tag}: ${msg}\n`, { flag: "a" });
  } catch { /* never fail the hook over logging */ }
}
```

(b) Add the dispatch case (after `lock release`):

```js
      case "hook session-end": {
        // SessionEnd shim — fires when the Claude Code session actually TERMINATES.
        // (Deliberately NOT Stop: Stop fires at the end of every turn while the session is
        // still alive — wiring it would spawn a competing driver against a live session.)
        // Best-effort: ALWAYS exit 0; a failing hook must never break Claude Code.
        const hook = readHookStdin();                  // { session_id, cwd, ... }
        const projDir = hook?.cwd || cwd;
        let cfg;
        try { cfg = loadConfig(projDir); } catch (e) { hookLog(env, "session-end", `skip: ${e.message}`, now()); return 0; }
        const key = `${cfg.teamId}-${cfg.projectSlug}`;
        const lockFile = lockPath(env, cfg.teamId, cfg.projectSlug);
        // "ours" = the lock pid is THIS ending session's claude ancestor — it may hand off.
        const self = findClaudeSessionPid(process.pid, psLookup);
        const lockState = evaluateLock(readLock(lockFile), isAlive, self.pid ?? null);

        const stamps = readStamps(stampsPath(env, key)).filter((t) => now() - t < RELAUNCH_WINDOW_MS);
        const backoff = backoffExceeded(stamps, now());
        // resumable? — the same probe as `loop resume --check`, in-process
        const fetched = await fetchResumeState(cfg, env, fetchImpl);
        const resumable = !!fetched && isResumable(fetched.state);

        const d = decideSessionEndRelaunch({ lockState, resumable, backoff });
        hookLog(env, "session-end", `lock=${lockState} resumable=${resumable} backoff=${backoff} → ${d.relaunch ? "RELAUNCH" : "skip"} (${d.reason})`, now());
        if (!d.relaunch) return 0;

        if (existsSync(lockFile)) rmSync(lockFile);    // release: this session is gone; the relaunch re-acquires
        mkdirSync(join(autoloopHome(env), "run"), { recursive: true });
        writeFileSync(stampsPath(env, key), JSON.stringify([...stamps, now()]));
        launchHeadless({ cwd: projDir, slug: cfg.projectSlug, env, spawnImpl, log });
        return 0;
      }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/autoloop.mjs functions/test/cli.unit.test.ts
git commit -m "feat(cli): hook session-end — relaunch a dying mid-loop session with lock + backoff guards

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: `hook wake` shim

**Files:**
- Modify: `cli/autoloop.mjs` (`hook wake` case)
- Test: `functions/test/cli.unit.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("hook wake", () => {
  function setup() {
    const home = tmp(); const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentLoopId: "l1", loops: {}, currentPhaseId: null, currentTaskId: null, phases: {}, tasks: {} });
    const spawned: any[] = [];
    const spawnImpl = (cmd: string, args: string[], opts: any) => { spawned.push({ cmd, args, opts }); return { pid: 999, unref: () => {} }; };
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
```

> Add `rmSync` to the `node:fs` import in the test file.

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: FAIL (`hook wake` unknown command).

- [ ] **Step 3: Implement**

Add after the `hook session-end` case:

```js
      case "hook wake": {
        // launchd interval shim (every 5 min; WorkingDirectory = project dir, baked into the
        // plist because launchd jobs have no cwd context). Linux runs the same verb from cron.
        let cfg;
        try { cfg = loadConfig(cwd); } catch (e) { hookLog(env, "wake", `skip: ${e.message}`, now()); return 0; }
        const lockFile = lockPath(env, cfg.teamId, cfg.projectSlug);
        const lockState = evaluateLock(readLock(lockFile), isAlive, null); // no claude ancestor under launchd

        const fetched = await fetchResumeState(cfg, env, fetchImpl);     // `loop resume` JSON
        const loopStatus = fetched?.state?.loop?.status;
        // pending messages — same probe as `messages pull --check`, in-process (GET only, never acks)
        const api = resolveApiUrl(cfg, env, undefined);
        const msgs = await getJson(`${api}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/messages`, { env, fetchImpl });
        const hasPendingMessages = !!(msgs?.ok && Array.isArray(msgs.body?.messages) && msgs.body.messages.length > 0);

        const d = decideWake({ lockState, loopStatus, hasPendingMessages });
        hookLog(env, "wake", `lock=${lockState} loop=${loopStatus ?? "none"} pending=${hasPendingMessages} → ${d.wake ? "WAKE" : "skip"} (${d.reason})`, now());
        if (!d.wake) return 0;
        if (lockState === "dead") rmSync(lockFile);    // steal the stale lock; the new session re-acquires
        launchHeadless({ cwd, slug: cfg.projectSlug, env, spawnImpl, log });
        return 0;
      }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/autoloop.mjs functions/test/cli.unit.test.ts
git commit -m "feat(cli): hook wake — bring a paused loop up when a dashboard message arrives

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: `init --relaunch` installer + `--uninstall` + `autoloop status`

**Files:**
- Modify: `cli/autoloop.mjs` (`detectAllowlist`, `wakePlist`, `installRelaunch`; wire into the `init` case; add the `status` case)
- Test: `functions/test/cli.unit.test.ts`

- [ ] **Step 1: Write the failing tests**

Add (extend the CLI import line with `detectAllowlist, wakePlist`):

```ts
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
    const execImpl = (cmd: string, args: string[]) => { execs.push({ cmd, args }); return ""; };
    return { home, dir, execs, execImpl,
      settingsPath: join(dir, ".claude", "settings.json"),
      plistPath: join(home, "Library", "LaunchAgents", "com.autoloop.wake.web.plist"),
      lockFile: join(home, ".autoloop", "run", "acme-web.lock") };
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
    expect(loadConfig(s.dir).relaunch).toBeUndefined();
    expect(s.execs.some((e) => e.cmd === "launchctl" && e.args[0] === "unload")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: FAIL (`init --relaunch` errors with "init requires --team"; `status` unknown command; pure fns not exported).

- [ ] **Step 3: Implement**

In `cli/autoloop.mjs`:

(a) Add after `hookLog`:

```js
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
    delete cfg.relaunch;
    saveConfig(projDir, cfg);
    log("autoloop: relaunch machinery uninstalled (SessionEnd hook, added allowlist entries, wake job, lock)");
    return 0;
  }

  // 1. ~/.autoloop home + a stable, version-independent CLI copy (refreshed on every install)
  mkdirSync(join(home, "run"), { recursive: true });
  mkdirSync(join(home, "logs"), { recursive: true });
  try { copyFileSync(process.argv[1], stableCli); }
  catch (e) { err(`autoloop: could not copy CLI to ${stableCli}: ${e.message}`); return 1; }

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
```

(b) Wire into the `init` case. At the very top of `case "init": {`:

```js
        // `autoloop init --relaunch [--uninstall]` manages host-side relaunch machinery for an
        // ALREADY-initialized project — no --team needed (mirrors the init --session-log /
        // `session-log` pair).
        if (flags.relaunch && !flags.team) {
          return installRelaunch(cwd, env, { log, err, execImpl, platform, uninstall: !!flags.uninstall });
        }
```

and before the final `return 0;` of the init case (after the `session-log` line), add:

```js
        if (flags.relaunch) return installRelaunch(cwd, env, { log, err, execImpl, platform, uninstall: !!flags.uninstall });
```

(c) Add the `status` case (after `state`):

```js
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: PASS (including the existing `init` tests — the relaunch branch must not change plain `init --team … --project …` behavior).

- [ ] **Step 5: Commit**

```bash
git add cli/autoloop.mjs functions/test/cli.unit.test.ts
git commit -m "feat(cli): init --relaunch installer (SessionEnd hook, allowlist, launchd wake job) + --uninstall + status

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Driver skill — Step 4 rewrite, lock integration, relaunch branch

**Files:**
- Modify: `plugins/autoloop/skills/autoloop/SKILL.md`
- Modify: `plugins/autoloop/.claude-plugin/plugin.json` (version `0.11.0` → `0.12.0`)

- [ ] **Step 1: Add the lock to Step 0 and Step 3b**

At the end of the Step 0 section (added in Task 5), append:

```markdown
**Lock (only when `autoloop status` reports `relaunchInstalled: true`):** claim the
project before driving it — `autoloop lock acquire`. If it exits 1, another live
session is already driving this project: report that and end this session.
```

In **Step 3b**, after the `autoloop loop set <loopId> --status completed` line, add:

```bash
autoloop lock release   # only when relaunch machinery is installed — frees the project lock
```

- [ ] **Step 2: Rewrite Step 4**

Replace the entire `## Step 4 — Paused: keep polling, act on the next message` section with:

```markdown
## Step 4 — Paused

A **stop/pause** message does NOT terminate the loop. On entering pause:

```bash
autoloop messages ack <stopMsgId>
autoloop loop set <loopId> --status paused
# reply so the dashboard shows you're parked and listening:
autoloop messages send --text "Paused. Send any message and I'll act on it and resume."
```

**Check `autoloop status` and branch on `relaunchInstalled`:**

### 4a. Relaunch machinery installed (`relaunchInstalled: true`)

Drain briefly, then **exit the session** — the wake job is the listener now, not you.
Burning tokens in an indefinite sleep-poll is exactly what the machinery replaces.

```bash
# Short drain window (4 polls × 30 s = 2 min) in case the user replies immediately:
for i in 1 2 3 4; do
  autoloop messages pull   # act on + ack anything that arrives; resume per the message
  sleep 30
done
# Nothing arrived — hand off to the wake job and END this session:
autoloop lock release
```

Then **end the session**. The launchd wake job (every 5 min) relaunches a headless
driver when a dashboard message arrives for the paused loop; the new session's Step 0
resume check rebuilds the plan and acts on the message. The SessionEnd hook will see
the loop is `paused` and correctly NOT relaunch (pause is woken by messages only).

**How the user actually stops Autoloop:** set the loop to a terminal status
(send a shutdown message, or `autoloop loop set <loopId> --status cancelled`) — or
remove the machinery entirely with `autoloop init --relaunch --uninstall`.

### 4b. No relaunch machinery (`relaunchInstalled: false`) — fallback

Keep the session alive and poll indefinitely — with no wake job, an exited session
would orphan the loop:

```bash
# Wait-for-next-message loop. Keep going; do NOT exit the session.
while true; do
  autoloop messages pull        # prints any pending user messages
  # → if one or more messages came back: break out and handle them (below)
  sleep 30
done
```

### Handling the message (both branches)

1. `autoloop messages ack <id>` for each.
2. **Do exactly what it says.** Treat it as a fresh user instruction:
   - A directive to keep building / continue / a new feature → `autoloop loop set
     <loopId> --status running` (or `loop start` a new iteration), then back to **Step 2**.
   - A scope/plan change → adjust the plan, then resume Step 2.
   - Only an explicit **shut down / exit / quit / we're done** → close the loop
     terminally (Step 3b, including `lock release`) and end the session.
3. Another pause → return to the start of Step 4.
```

- [ ] **Step 3: Update the Rules section**

Replace the `**Pause ≠ exit.**` rule with:

```markdown
- **Pause parks the loop, never orphans it.** With relaunch machinery installed
  (`autoloop status` → `relaunchInstalled: true`), a paused session drains briefly,
  releases the lock and EXITS — the 5-min wake job relaunches on the next dashboard
  message. Without it, the session stays alive polling (Step 4b) — exiting would
  orphan the loop. Either way the next message may be any prompt, not the word
  "resume" — act on whatever it says. Only an explicit shutdown/exit message (or a
  terminal loop status) actually stops Autoloop.
```

- [ ] **Step 4: Bump the plugin version**

`plugins/autoloop/.claude-plugin/plugin.json`: `"version": "0.11.0"` → `"version": "0.12.0"`.

- [ ] **Step 5: Skill-vs-CLI prose check**

Every command named in the edited sections must exist in `cli/autoloop.mjs` with real flags: `autoloop status`, `lock acquire`, `lock release`, `loop resume`, `messages pull`, `messages ack`, `messages send`, `loop set --status`, `init --relaunch --uninstall`. Grep each; fix prose (never invent flags) if any miss.

- [ ] **Step 6: Commit**

```bash
git add plugins/autoloop/skills/autoloop/SKILL.md plugins/autoloop/.claude-plugin/plugin.json
git commit -m "feat(skill): paused sessions exit + wake-job listener; project lock; relaunch branch (0.12.0)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Final gates — sync, full suites, manual relaunch checklist

**Files:**
- Modify (generated): `plugins/autoloop/bin/autoloop`, `web/public/skill/autoloop.mjs`, `web/public/skill/autoloop/SKILL.md`

- [ ] **Step 1: Sync the CLI + skill copies and verify identical**

Run: `bash scripts/sync-autoloop-cli.sh`
Then: `diff cli/autoloop.mjs plugins/autoloop/bin/autoloop && diff cli/autoloop.mjs web/public/skill/autoloop.mjs && diff plugins/autoloop/skills/autoloop/SKILL.md web/public/skill/autoloop/SKILL.md && echo IDENTICAL`
Expected: `IDENTICAL`.

- [ ] **Step 2: Build + full suites**

Run: `cd functions && npm run build && npm test && npm run test:rules`
Expected: build clean; ALL main-suite tests green (loopState + cli.unit + every pre-existing file — no regression from the `TERMINAL_STATUSES` hoist or the `init` case changes); rules suite green (no rules change was made — this is the guard).

- [ ] **Step 3: Commit the synced copies**

```bash
git add plugins/autoloop/bin/autoloop web/public/skill/autoloop.mjs web/public/skill/autoloop/SKILL.md
git commit -m "chore(cli): sync autoloop CLI + skill copies (resumable loops)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Manual verification checklist (OS wiring — launchd + SessionEnd)**

The decision functions are unit-tested; only the wiring below is manual (same approach as the session-log hook). Run on a macOS host with a real initialized project and `AUTOLOOP_API_KEY` exported:

1. **Install:** `autoloop init --relaunch` → project `.claude/settings.json` has the SessionEnd hook + allowlist; `~/.autoloop/{autoloop-cli.mjs,run,logs}` exist; `launchctl list | grep com.autoloop.wake.<slug>` shows the job; `autoloop status` reports `relaunchInstalled: true`.
2. **Resume (Phase 1):** start `/autoloop`, let it register a plan and complete ≥1 task, kill the session hard (close the terminal). Open a fresh session, run `/autoloop`: Step 0 must print the resume header, skip setup, drain any pending messages, and continue from the first non-terminal task.
3. **SessionEnd relaunch:** with a loop `running`, exit the session (`/exit` or quit the app). Within seconds `~/.autoloop/logs/hooks.log` shows a `session-end: … RELAUNCH` line and `~/.autoloop/logs/<slug>.log` starts filling; the dashboard shows the loop progressing again.
4. **No competing driver:** while the relaunched headless session is live, start a second `/autoloop` in another terminal — its `autoloop lock acquire` must exit 1 and the session must stand down.
5. **Paused wake:** send a pause message; verify the session drains ≤2 min, runs `lock release`, and exits. Send any message from the dashboard; within ~5 minutes the wake job launches a headless session (`hooks.log` shows `wake: … WAKE`), which acks the message and resumes.
6. **SessionEnd ≠ Stop sanity:** during a live multi-turn session, confirm `hooks.log` gets NO `session-end` lines between turns (only on actual termination).
7. **Backoff:** simulate a crash loop (e.g. temporarily break the project so the headless run dies immediately) — after 3 relaunches in 30 min, `hooks.log` shows the backoff skip line and relaunching stops.
8. **Headless permissions:** in `~/.autoloop/logs/<slug>.log`, confirm the headless driver runs `autoloop`/`git`/test commands without prompts, and that anything outside the allowlist is denied-and-logged (never prompts).
9. **Uninstall:** `autoloop init --relaunch --uninstall` → hook entry, added allow entries, plist (unloaded), and lock are gone; `autoloop status` reports `relaunchInstalled: false`; exiting a mid-loop session no longer relaunches.
10. **Linux variant (if a Linux host is available):** install the documented crontab line and repeat step 5.

Record the outcome of each item in the PR description.

---

## Definition of done

- `GET …/loops/:loopId/state` and `GET …/state` return the aggregated bundle (`requireApiKeyMember`): ordered phases/tasks, project-level scenarios with loop-scoped latest composite/test-run selected by ULID, open bugs only, oldest-first pending messages; 404 on missing loop/project, 401 unauthenticated. No schema or rules change.
- `autoloop loop resume [loopId]` prints header + pretty JSON with the cfg→server fallback chain and always exits 0; `--check` exits 0 silently iff a non-terminal, non-paused loop exists. `messages pull --check` exits 0 iff pending messages exist, without acking.
- Driver skill Step 0 resumes a mid-flight loop (skip setup, rebuild plan, drain messages first, paused → Step 4); Step 4 exits paused sessions when relaunch machinery is installed (sleep-poll remains the documented fallback) and documents how users stop.
- `autoloop init --relaunch` idempotently installs: stable CLI under `~/.autoloop/`, project-level SessionEnd hook, `permissions.allow` (autoloop/git + detected runners; no `--dangerously-skip-permissions`), `com.autoloop.wake.<slug>` launchd plist with baked WorkingDirectory (documented crontab for Linux); `--uninstall` removes all of it plus the lock; `autoloop status` reports the marker.
- Lock: `~/.autoloop/run/<teamId>-<slug>.lock` records the claude-session PID (ancestor walk, `--pid` override, direct-parent fallback with warning); `kill -0` liveness; steal-when-dead; all relaunch triggers no-op on a live foreign lock.
- Backoff: more than 3 relaunches in 30 minutes stops relaunching with a log line.
- All decision logic (`findClaudeSessionPid`, `evaluateLock`, `backoffExceeded`, `decideSessionEndRelaunch`, `decideWake`, `isResumable`, `firstNonTerminalTask`, `detectAllowlist`, `wakePlist`) is unit-tested; the OS wiring passed the manual checklist.
- `functions` build clean; full main + rules suites green; three CLI copies and both SKILL.md copies identical; plugin at 0.12.0.

## Out of scope (per spec)

- A persistent daemon owning loop lifecycle (explicitly rejected).
- Cross-machine resume (lock + hooks are per-host; the state endpoint is machine-agnostic).
- Windows host support.
- Realtime push wake (5-min poll accepted; FCM/webhook is future work shared with native apps SP4).
- Converging the session-log hook's `~/.claude/autoloop-cli.mjs` copy into `~/.autoloop/` (deliberately deferred).
