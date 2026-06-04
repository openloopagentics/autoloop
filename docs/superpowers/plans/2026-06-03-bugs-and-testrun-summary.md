# Bugs + test-run summary (contract) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a trackable `bug` entity (open/fixed lifecycle, base-path-aware) and an optional `summary` field on the `testRun` event, across backend + CLI + rules-tests + validation.

**Architecture:** Purely additive, mirroring the loop-level contract (v2.1). The `bug` entity is an idempotent `PUT` with a client-supplied id, made base-path-aware (project-direct OR under `loops/{loopId}`) by reusing the `resolveBase` helper extracted from `events.ts`. A bug is run data — no derived `currentX`, no `visionOwner` stamp, no transaction. `testRun.summary` is an optional capped string added conditionally so the omitted case stays byte-identical.

**Tech Stack:** Firebase Cloud Functions v2 (TypeScript, Firestore Admin SDK), Express routers, zod validation, Vitest + Firestore emulator, dependency-free Node CLI (`cli/daloop.mjs`).

**Spec:** `docs/superpowers/specs/2026-06-03-bugs-and-testrun-summary-design.md`

**Conventions (read before starting):**
- Run a single functions test file with the emulator already running: `cd functions && npm run test:run -- <name>`. The full suite (spins up the emulator) is `cd functions && npm test`. Rules tests: `cd functions && npm run test:rules` (or via the full `npm test`).
- All new entity bodies enforce required-on-create in the **service layer**, not zod (zod marks fields optional). See `services/loops.ts` and `services/goals.ts`.
- Commit messages end with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: `bugBody` schema + `testRunBody.summary`

**Files:**
- Modify: `functions/src/schemas.ts` (add `bugBody` after the `const id` declaration ~line 44; extend `testRunBody` ~line 96-102)
- Test: `functions/test/schemas.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `functions/test/schemas.test.ts` (import `bugBody` and `testRunBody` from `../src/schemas.js` — extend the existing import line):

```ts
describe("bugBody", () => {
  it("accepts a minimal open bug", () => {
    expect(bugBody.safeParse({ title: "X", status: "open" }).success).toBe(true);
  });
  it("accepts the optional fields", () => {
    expect(bugBody.safeParse({ title: "X", status: "fixed", description: "d", scenarioId: "s1", taskId: "t1", severity: "high" }).success).toBe(true);
  });
  it("rejects an unknown status", () => {
    expect(bugBody.safeParse({ title: "X", status: "wontfix" }).success).toBe(false);
  });
  it("rejects an unknown severity", () => {
    expect(bugBody.safeParse({ title: "X", status: "open", severity: "blocker" }).success).toBe(false);
  });
  it("rejects a non-idPattern scenarioId", () => {
    expect(bugBody.safeParse({ title: "X", status: "open", scenarioId: "Bad Id" }).success).toBe(false);
  });
  it("drops unknown keys (plain z.object)", () => {
    const parsed = bugBody.parse({ title: "X", status: "open", createdAt: "nope" });
    expect("createdAt" in parsed).toBe(false);
  });
});

describe("testRunBody.summary", () => {
  it("accepts an optional summary", () => {
    expect(testRunBody.safeParse({ scenarioId: "s1", taskId: "t1", passed: 1, failed: 0, summary: "ran fine" }).success).toBe(true);
  });
  it("rejects a summary over 100KB", () => {
    const big = "x".repeat(100 * 1024 + 1);
    expect(testRunBody.safeParse({ scenarioId: "s1", taskId: "t1", passed: 1, failed: 0, summary: big }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- schemas`
Expected: FAIL (`bugBody` is not exported; the `summary` over-limit test fails because the field is currently dropped, so the parse succeeds).

- [ ] **Step 3: Implement**

In `functions/src/schemas.ts`, add **after** the `const id = z.string().regex(idPattern);` line (it reuses `id`):

```ts
const severity = z.enum(["low", "medium", "high"]);
const bugStatus = z.enum(["open", "fixed"]);
export const bugBody = z.object({
  title: z.string().min(1).optional(),       // required-on-create in the service
  description: z.string().optional(),
  scenarioId: id.optional(),
  taskId: id.optional(),
  severity: severity.optional(),
  status: bugStatus.optional(),              // required-on-create in the service
});
export type BugBody = z.infer<typeof bugBody>;
```

Extend `testRunBody` (add the `summary` line inside the existing object; `CONTENT_MAX_BYTES` is already declared at the top of the file):

```ts
export const testRunBody = z.object({
  scenarioId: id,
  taskId: id,
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  issues: z.array(z.string()).optional(),
  summary: z.string().max(CONTENT_MAX_BYTES, "testRun.summary exceeds 100KB").optional(),
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- schemas`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/schemas.ts functions/test/schemas.test.ts
git commit -m "feat(contract): add bugBody schema + optional testRun.summary

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Extract `resolveBase` into `services/baseRef.ts`

Pure refactor — no behavior change. `events.ts` keeps identical behavior; `bugs.ts` (Task 3) reuses the helper.

**Files:**
- Create: `functions/src/services/baseRef.ts`
- Modify: `functions/src/services/events.ts:1-24` (remove the local `requireProject` + `resolveBase`, import them)
- Test: existing `functions/test/events.test.ts` must stay green (the guard).

- [ ] **Step 1: Create the helper**

`functions/src/services/baseRef.ts`:

```ts
import { db } from "../firestore.js";
import { AppError } from "../errors.js";

async function requireProject(teamId: string, slug: string) {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const snap = await projectRef.get();
  if (!snap.exists) throw new AppError(404, "not_found", "project does not exist");
  return projectRef;
}

/**
 * Resolve the base ref for run-data writes: the loop doc when loop-scoped, else the project.
 * Verifies the project (always) and the loop (when loopId) exist.
 */
export async function resolveBase(teamId: string, slug: string, loopId?: string) {
  const projectRef = await requireProject(teamId, slug);
  if (!loopId) return { projectRef, baseRef: projectRef };
  const loopRef = projectRef.collection("loops").doc(loopId);
  if (!(await loopRef.get()).exists) throw new AppError(404, "not_found", "loop does not exist");
  return { projectRef, baseRef: loopRef };
}
```

- [ ] **Step 2: Update `events.ts` to import it**

In `functions/src/services/events.ts`, delete the local `requireProject` (lines 7-12) and `resolveBase` (lines 14-24), and add to the imports at the top:

```ts
import { resolveBase } from "./baseRef.js";
```

Leave the three `appendScore`/`appendTestRun`/`appendRevision` bodies unchanged (they already call `resolveBase`). **Remove the now-unused `db` import** (its only use was inside the extracted `requireProject`); keep `FieldValue`, `AppError`, `ulid` (still used by the appenders — `AppError` by `appendScore`'s scenario/criterion checks).

- [ ] **Step 3: Run the events suite to verify no regression**

Run: `cd functions && npm run test:run -- events`
Expected: PASS (all existing score/testRun/revision + loop-scoped tests still green).

- [ ] **Step 4: Build to verify no unused-import / type errors**

Run: `cd functions && npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/baseRef.ts functions/src/services/events.ts
git commit -m "refactor(contract): extract resolveBase into services/baseRef.ts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `upsertBug` service

**Files:**
- Create: `functions/src/services/bugs.ts`
- Test: `functions/test/bugs.test.ts`

- [ ] **Step 1: Write the failing tests**

`functions/test/bugs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import "./helpers.js";
import { seedMember } from "./helpers.js";
import { db } from "../src/firestore.js";
import { upsertBug } from "../src/services/bugs.js";
import { upsertLoop } from "../src/services/loops.js";

async function seedProject(teamId = "team1", slug = "acme") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
  await seedMember(teamId);
  await db().doc(`teams/${teamId}/projects/${slug}`).set({ title: "Acme", status: "running" });
}

describe("upsertBug", () => {
  it("requires title and status on create", async () => {
    await seedProject();
    await expect(upsertBug("team1", "acme", "b1", { title: "X" })).rejects.toMatchObject({ httpStatus: 400 });
    await expect(upsertBug("team1", "acme", "b1", { status: "open" })).rejects.toMatchObject({ httpStatus: 400 });
  });

  it("creates a bug project-direct with createdAt + fixedAt:null", async () => {
    await seedProject();
    await upsertBug("team1", "acme", "b1", { title: "Login breaks", status: "open", severity: "high", scenarioId: "s1", taskId: "t1" });
    const d = (await db().doc("teams/team1/projects/acme/bugs/b1").get()).data()!;
    expect(d.title).toBe("Login breaks");
    expect(d.status).toBe("open");
    expect(d.severity).toBe("high");
    expect(d.scenarioId).toBe("s1");
    expect(d.createdAt).toBeDefined();
    expect(d.fixedAt).toBeNull();
  });

  it("updates in place and stamps fixedAt once on first fix (stable across re-PUTs)", async () => {
    await seedProject();
    await upsertBug("team1", "acme", "b1", { title: "X", status: "open" });
    await upsertBug("team1", "acme", "b1", { status: "fixed" });
    const fixed1 = (await db().doc("teams/team1/projects/acme/bugs/b1").get()).data()!.fixedAt;
    expect(fixed1).not.toBeNull();
    // re-PUT fixed again -> fixedAt unchanged
    await upsertBug("team1", "acme", "b1", { status: "fixed", title: "X2" });
    const d = (await db().doc("teams/team1/projects/acme/bugs/b1").get()).data()!;
    expect(d.title).toBe("X2");
    expect(d.fixedAt.toMillis()).toBe(fixed1.toMillis());
  });

  it("writes loop-scoped under loops/{id}/bugs and 404s when the loop is absent", async () => {
    await seedProject();
    await upsertLoop("team1", "acme", "l1", { goal: "g", order: 1, status: "running" });
    await upsertBug("team1", "acme", "b1", { title: "X", status: "open" }, "l1");
    expect((await db().doc("teams/team1/projects/acme/loops/l1/bugs/b1").get()).exists).toBe(true);
    expect((await db().doc("teams/team1/projects/acme/bugs/b1").get()).exists).toBe(false);
    await expect(upsertBug("team1", "acme", "b2", { title: "X", status: "open" }, "ghost"))
      .rejects.toMatchObject({ httpStatus: 404 });
  });

  it("404s when the project does not exist", async () => {
    await db().doc("teams/team1").set({ name: "T", createdBy: "u1" });
    await seedMember("team1");
    await expect(upsertBug("team1", "ghost", "b1", { title: "X", status: "open" }))
      .rejects.toMatchObject({ httpStatus: 404 });
  });
});
```

> Note: `AppError` carries `httpStatus` — the service throws `AppError`, so `.rejects.toMatchObject({ httpStatus: 400/404 })` works (matches how `events.test.ts` asserts loop-scoped failures). No need to import `AppError` in the test.

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- bugs`
Expected: FAIL (`services/bugs.js` does not exist).

- [ ] **Step 3: Implement**

`functions/src/services/bugs.ts`:

```ts
import { FieldValue } from "firebase-admin/firestore";
import { AppError } from "../errors.js";
import { resolveBase } from "./baseRef.js";
import type { BugBody } from "../schemas.js";

/**
 * Upsert a bug (idempotent PUT). Base-path-aware: loop-scoped when loopId is set, else
 * project-direct. A bug is run data — no derived currentX, no visionOwner stamp.
 * fixedAt is stamped the FIRST time status becomes "fixed" and never updated after.
 * Non-transactional: a single doc merge with no derived fields (mirrors the event appenders).
 */
export async function upsertBug(teamId: string, slug: string, bugId: string, body: BugBody, loopId?: string): Promise<void> {
  const { baseRef } = await resolveBase(teamId, slug, loopId);
  const bugRef = baseRef.collection("bugs").doc(bugId);
  const snap = await bugRef.get();
  const creating = !snap.exists;
  if (creating && (body.title === undefined || body.status === undefined)) {
    throw new AppError(400, "validation", "title and status are required when creating a bug");
  }
  const existing = snap.data() ?? {};
  const newStatus = body.status ?? existing.status;

  const data: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (creating) { data.createdAt = FieldValue.serverTimestamp(); data.fixedAt = null; }
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description;
  if (body.scenarioId !== undefined) data.scenarioId = body.scenarioId;
  if (body.taskId !== undefined) data.taskId = body.taskId;
  if (body.severity !== undefined) data.severity = body.severity;
  if (body.status !== undefined) data.status = body.status;
  // fixedAt = the FIRST transition to "fixed"; once set it is never updated (mirrors phase endedAt).
  if (newStatus === "fixed" && !existing.fixedAt) data.fixedAt = FieldValue.serverTimestamp();

  await bugRef.set(data, { merge: true });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- bugs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/bugs.ts functions/test/bugs.test.ts
git commit -m "feat(contract): upsertBug service (base-path-aware, fixedAt-once)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Bug router + mounts

**Files:**
- Create: `functions/src/routes/bugs.ts`
- Modify: `functions/src/app.ts` (import + two mounts)
- Test: extend `functions/test/bugs.test.ts` with Supertest API tests.

- [ ] **Step 1: Write the failing API tests**

Append to `functions/test/bugs.test.ts` (add the imports `request from "supertest"`, `authHeader` from `./helpers.js`, `makeApp` from `../src/app.js` at the top):

```ts
import request from "supertest";
import { authHeader } from "./helpers.js";
import { makeApp } from "../src/app.js";

const app = makeApp();

describe("PUT bugs (API)", () => {
  it("creates a bug via the project-direct route", async () => {
    await seedProject();
    const res = await request(app).put("/v1/teams/team1/projects/acme/bugs/b1").set(authHeader())
      .send({ title: "Login breaks", status: "open" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect((await db().doc("teams/team1/projects/acme/bugs/b1").get()).data()!.title).toBe("Login breaks");
  });

  it("creates a bug via the loop-scoped route", async () => {
    await seedProject();
    await upsertLoop("team1", "acme", "l1", { goal: "g", order: 1, status: "running" });
    const res = await request(app).put("/v1/teams/team1/projects/acme/loops/l1/bugs/b1").set(authHeader())
      .send({ title: "X", status: "open" });
    expect(res.status).toBe(200);
    expect((await db().doc("teams/team1/projects/acme/loops/l1/bugs/b1").get()).exists).toBe(true);
  });

  it("400s when creating without title+status", async () => {
    await seedProject();
    const res = await request(app).put("/v1/teams/team1/projects/acme/bugs/b1").set(authHeader())
      .send({ title: "X" });
    expect(res.status).toBe(400);
  });

  it("400s on an unknown status enum", async () => {
    await seedProject();
    const res = await request(app).put("/v1/teams/team1/projects/acme/bugs/b1").set(authHeader())
      .send({ title: "X", status: "wontfix" });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- bugs`
Expected: FAIL (route 404s — no mount yet).

- [ ] **Step 3: Implement the router**

`functions/src/routes/bugs.ts`:

```ts
import { Router } from "express";
import { idPattern, bugBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { upsertBug } from "../services/bugs.js";

export const bugsRouter = Router({ mergeParams: true });

bugsRouter.put("/:bugId", async (req, res, next) => {
  try {
    const { teamId, slug, bugId, loopId } = req.params as { teamId: string; slug: string; bugId: string; loopId?: string };
    for (const [name, val] of [["teamId", teamId], ["slug", slug], ["bugId", bugId]] as const) {
      if (!idPattern.test(val)) throw new AppError(400, "validation", `invalid ${name}`);
    }
    if (loopId !== undefined && !idPattern.test(loopId)) throw new AppError(400, "validation", "invalid loopId");
    const parsed = bugBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    await upsertBug(teamId, slug, bugId, parsed.data, loopId);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Mount in `app.ts`**

Add the import next to the other route imports:

```ts
import { bugsRouter } from "./routes/bugs.js";
```

Add the **project-direct** mount with the other project-direct entity mounts (immediately after the `teamRouter.use("/:slug/revisions", revisionsRouter);` line):

```ts
  teamRouter.use("/:slug/bugs", bugsRouter);
```

Add the **loop-scoped** mount with the other `…/loops/:loopId/*` mounts (immediately after `teamRouter.use("/:slug/loops/:loopId/revisions", revisionsRouter);`, i.e. BEFORE `teamRouter.use("/:slug/loops", loopsRouter);`):

```ts
  teamRouter.use("/:slug/loops/:loopId/bugs", bugsRouter);
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd functions && npm run test:run -- bugs`
Expected: PASS (service + API tests).

- [ ] **Step 6: Commit**

```bash
git add functions/src/routes/bugs.ts functions/src/app.ts functions/test/bugs.test.ts
git commit -m "feat(contract): bug router + project-direct & loop-scoped mounts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `appendTestRun` stores `summary`

**Files:**
- Modify: `functions/src/services/events.ts` (`appendTestRun`, ~lines 58-71)
- Test: `functions/test/events.test.ts` (extend the testRuns describe block)

- [ ] **Step 1: Write the failing tests**

Add to the `describe("POST /v1/teams/:teamId/projects/:slug/testRuns", …)` block in `functions/test/events.test.ts`:

```ts
  it("stores a summary when provided", async () => {
    await createProject();
    const res = await request(app).post("/v1/teams/team1/projects/acme/testRuns").set(authHeader())
      .send({ scenarioId: "s1", taskId: "t1", passed: 8, failed: 1, summary: "# Run\nlogin flow exercised" });
    expect(res.status).toBe(200);
    const d = (await db().doc(`teams/team1/projects/acme/testRuns/${res.body.id}`).get()).data()!;
    expect(d.summary).toBe("# Run\nlogin flow exercised");
  });

  it("omits the summary key when not provided", async () => {
    await createProject();
    const res = await request(app).post("/v1/teams/team1/projects/acme/testRuns").set(authHeader())
      .send({ scenarioId: "s1", taskId: "t1", passed: 1, failed: 0 });
    const d = (await db().doc(`teams/team1/projects/acme/testRuns/${res.body.id}`).get()).data()!;
    expect(d.summary).toBeUndefined();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- events`
Expected: FAIL (`d.summary` is undefined in the "stores a summary" test).

- [ ] **Step 3: Implement**

Replace the body of `appendTestRun` in `functions/src/services/events.ts` so it builds a `data` object and adds `summary` conditionally:

```ts
export async function appendTestRun(teamId: string, slug: string, body: TestRunBody, loopId?: string): Promise<string> {
  const { baseRef } = await resolveBase(teamId, slug, loopId);
  const id = ulid();
  // No transaction needed: the id is server-generated (no write-write conflict) and no derived fields are updated.
  const data: Record<string, unknown> = {
    scenarioId: body.scenarioId,
    taskId: body.taskId,
    passed: body.passed,
    failed: body.failed,
    issues: body.issues ?? [],
    createdAt: FieldValue.serverTimestamp(),
  };
  if (body.summary !== undefined) data.summary = body.summary;
  await baseRef.collection("testRuns").doc(id).set(data);
  return id;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- events`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/events.ts functions/test/events.test.ts
git commit -m "feat(contract): store optional summary on testRun events

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Rules tests for the bug subtree

No rules change (the recursive `match /projects/{slug}/{document=**}` already covers `bugs/{id}` and `loops/{id}/bugs/{id}`). Add tests asserting member-read / non-member-deny / client-write-deny.

**Files:**
- Modify: `functions/test-rules/rules.test.ts` (extend `seedProjectTree` + the two `paths` arrays)

- [ ] **Step 1: Seed bug docs in `seedProjectTree`**

In `functions/test-rules/rules.test.ts`, inside `seedProjectTree` add a project-direct bug (with the project-direct loop-contract docs, after the `documents/d1` line ~248):

```ts
    await fs.doc(`teams/${teamId}/projects/web/bugs/b1`).set({ title: "B", status: "open" });
```

and a loop-scoped bug (with the loop subtree docs, after the `loops/l1/scores/01XYZ` line ~254):

```ts
    await fs.doc(`teams/${teamId}/projects/web/loops/l1/bugs/b1`).set({ title: "B", status: "open" });
```

- [ ] **Step 2: Add the paths to the two describe blocks**

In `describe("rules: loop-contract subcollections", …)` add `"bugs/b1"` to its `paths` array. In `describe("rules: loop subcollections", …)` add `"loops/l1/bugs/b1"` to its `paths` array. (Both blocks already assert read-allow for members, read-deny for non-members, and write-deny for owners over every path.)

- [ ] **Step 3: Run the rules suite to verify it passes**

Run: `cd functions && npm run test:rules`
Expected: PASS (the new bug paths are member-readable, non-member-denied, client-write-denied — covered by the recursive rule with no rules change).

- [ ] **Step 4: Commit**

```bash
git add functions/test-rules/rules.test.ts
git commit -m "test(rules): cover bugs subtree (member-read, client-write-deny)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: CLI `bug add` / `bug set`

**Files:**
- Modify: `cli/daloop.mjs` (add two cases in the dispatch switch ~after the `doc add` case at line 268; `bug add`/`bug set` are two-word verbs — do NOT add to `ONE_WORD`)
- Test: `functions/test/cli.unit.test.ts` (new describe block)

- [ ] **Step 1: Write the failing tests**

Add a describe block to `functions/test/cli.unit.test.ts` (model on the "loop start/set + loop-aware URLs" block ~line 299):

```ts
describe("bug add/set verbs", () => {
  function initDir(extra: Record<string, unknown> = {}) {
    const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentPhaseId: "p1", currentTaskId: "t1", currentLoopId: null, loops: {}, phases: {}, tasks: {}, ...extra });
    return dir;
  }
  const cap = () => { const c: any = { calls: [] }; c.fetchImpl = async (url: string, init: any) => { c.calls.push({ url, init }); c.url = url; c.init = init; return { ok: true, status: 200, json: async () => ({ ok: true }) }; }; return c; };
  const base = (dir: string, c: any) => ({ cwd: dir, env: { DALOOP_API_KEY: "dl_k" }, log: () => {}, err: () => {}, fetchImpl: c.fetchImpl });

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
    const code = await run(["bug", "add", "b1", "--title", "X", "--severity", "blocker"], { cwd: dir, env: { DALOOP_API_KEY: "dl_k" }, log: () => {}, err: (m: string) => errs.push(m), fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).not.toBe(0);
  });

  it("bug set requires at least one field", async () => {
    const dir = initDir(); const errs: string[] = [];
    const code = await run(["bug", "set", "b1"], { cwd: dir, env: { DALOOP_API_KEY: "dl_k" }, log: () => {}, err: (m: string) => errs.push(m), fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).not.toBe(0);
  });
});
```

> Confirm the existing tests import `run`, `tmp`, `saveConfig`, `loadConfig` at the top of `cli.unit.test.ts` (they do — reuse them). A `UsageError` makes `run` return a non-zero exit code, which is what the rejection tests assert.

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: FAIL (no `bug add`/`bug set` cases — dispatch throws "unknown command" / returns non-zero, and the happy-path URL assertions fail).

- [ ] **Step 3: Implement the two cases**

In `cli/daloop.mjs`, add after the `doc add` case (ends ~line 284), before `case "commit"`:

```js
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
          { env, fetchImpl, err, strict: !!flags.strict || env.DALOOP_STRICT === "1", teamId: cfg.teamId });
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
          { env, fetchImpl, err, strict: !!flags.strict || env.DALOOP_STRICT === "1", teamId: cfg.teamId });
      }
```

If there is a `--help`/usage string listing verbs in `cli/daloop.mjs`, add `bug add`/`bug set` to it (grep for `doc add` in the usage text; if present, mirror it).

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/daloop.mjs functions/test/cli.unit.test.ts
git commit -m "feat(cli): bug add/set verbs (loop-aware, open/fixed)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: CLI `test-run --summary` / `--summary-file`

**Files:**
- Modify: `cli/daloop.mjs` (`test-run` case ~lines 332-341)
- Test: `functions/test/cli.unit.test.ts` (extend the "event + vision verbs" block)

- [ ] **Step 1: Write the failing tests**

Add to the `describe("event + vision verbs (request shapes)", …)` block in `functions/test/cli.unit.test.ts`:

```ts
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
```

> `writeFileSync` and `join` are already imported at the top of `cli.unit.test.ts` (the `vision import` test uses them). Reuse them.

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: FAIL (`summary` absent from the body).

- [ ] **Step 3: Implement**

In `cli/daloop.mjs`, in the `test-run` case, after the `const body = { … issues: … };` line and before `const cfg = loadConfig(cwd);`, add:

```js
        if (flags["summary-file"]) {
          try { body.summary = readFileSync(join(cwd, flags["summary-file"]), "utf8"); }
          catch (e) { throw new UsageError(`could not read --summary-file '${flags["summary-file"]}': ${e.message}`); }
        } else if (flags.summary) {
          body.summary = flags.summary;
        }
```

(`readFileSync` and `join` are already imported at the top of `cli/daloop.mjs`.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/daloop.mjs functions/test/cli.unit.test.ts
git commit -m "feat(cli): test-run --summary / --summary-file

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Sync CLI copies + full green

**Files:**
- Modify (generated): `plugins/daloop-reporting/bin/daloop`, `web/public/skill/daloop.mjs` (via the sync script)

- [ ] **Step 1: Sync the CLI copies**

Run: `bash scripts/sync-daloop-cli.sh`
Expected: prints the `✓ synced …` lines.

- [ ] **Step 2: Verify the three copies are identical**

Run: `diff cli/daloop.mjs plugins/daloop-reporting/bin/daloop && diff cli/daloop.mjs web/public/skill/daloop.mjs && echo IDENTICAL`
Expected: `IDENTICAL` (no diff output).

- [ ] **Step 3: Build + full suite**

Run: `cd functions && npm run build && npm test`
Expected: build clean; ALL suites green (main + rules), including the pre-existing tests (no regression from the `resolveBase` extraction).

- [ ] **Step 4: Commit**

```bash
git add plugins/daloop-reporting/bin/daloop web/public/skill/daloop.mjs
git commit -m "chore(cli): sync daloop CLI copies (bug verbs + test-run summary)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Definition of done

- `bug` entity reportable via `PUT …/bugs/:bugId` and `PUT …/loops/:loopId/bugs/:bugId`, idempotent, required-on-create (title+status), `fixedAt` stamped once and stable.
- `testRun.summary` stored when provided, byte-identical when omitted.
- `daloop bug add/set` (loop-aware, open/fixed, severity validated) and `daloop test-run --summary/--summary-file` work; the three CLI copies are identical.
- Rules unchanged; the bug subtree is member-readable and client-write-denied (tested).
- `functions` build clean; the full main + rules suites pass with zero regression.

## Out of scope (separate sub-projects)

- The tabbed tracking UI (Dashboard/Vision/Loops/Bugs, loop selector + per-loop scoping, rollups, in-progress prominence, only-current-is-live, the Bugs view, rendering `testRun.summary`).
- `/daloop` driver hygiene (task-status transitions, opening/fixing bugs, uploading summaries, `loop start` at run start).
- Per-loop notifications (incl. a future "bug opened" notification).
