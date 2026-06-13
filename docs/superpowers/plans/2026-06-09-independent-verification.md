# Independent verification + deterministic backstop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the loop's two integrity gaps: (a) a deterministic server **backstop** — when a loop (or project, for project-direct data) transitions into a terminal status, sweep its non-terminal phases/tasks to that same terminal status and null the derived pointers; (b) an independent **verification** event — a clean-context verifier replays recorded test commands and its verdict lands as a new append-only `verification` event, surfaced as Verified/Unverified/Refuted badges in the UI. Met-state derivation is unchanged.

**Architecture:** `verifications` joins `scores`/`testRuns`/`revisions` as base-path-aware run data: server-ULID id, append-only POST, project-direct OR loop-scoped via `resolveBase`, no transaction, no derived fields, no rules change (the recursive project-subtree rule already covers it). The backstop rides the existing `PUT …/loops/:loopId` (and `PUT …/projects/:slug` for the implicit `main` loop): terminal-transition detection happens inside the existing transaction, the flag is carried out, and a best-effort batched sweep runs after the commit — the close itself never fails because the sweep failed. The web adds a pure `verificationView.ts` + a badge layer on top of the untouched `scenarioState.ts`.

**Tech Stack:** Firebase Cloud Functions v2 (TypeScript, Firestore Admin SDK), Express routers, zod validation, Vitest + Firestore emulator, dependency-free Node CLI (`cli/autoloop.mjs`), React 18 + Firestore web SDK + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-09-independent-verification-design.md`

**Conventions (read before starting):**
- Run a single functions test file with the emulator already running (`cd functions && npm run emulators` in another terminal): `cd functions && npm run test:run -- <name>`. The full suite (spins up the emulator itself) is `cd functions && npm test`. Rules tests: `cd functions && npm run test:rules`. Web tests: `cd web && npm test` (plain `vitest run`, no emulator).
- Required-on-create is enforced in the **service layer**, not zod (zod marks fields optional). See `services/loops.ts` and `services/projects.ts`. Verification is an append-only event, so its zod body marks the required fields required (like `scoreBody`/`testRunBody`).
- Commit messages end with the trailer:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- The CLI has **3 synced copies**: `cli/autoloop.mjs` (canonical), `plugins/autoloop/bin/autoloop`, `web/public/skill/autoloop.mjs`. After editing the canonical copy run `bash scripts/sync-autoloop-cli.sh`. The same script also syncs `plugins/autoloop/skills/autoloop/SKILL.md` → `web/public/skill/autoloop/SKILL.md`. Skill changes require a `plugins/autoloop/.claude-plugin/plugin.json` version bump (currently `0.10.1`; this feature bumps to `0.11.0`).

---

### Task 1: `verificationBody` schema

**Files:**
- Modify: `functions/src/schemas.ts` (add after `testRunBody`, ~line 124; `CONTENT_MAX_BYTES` and `id` already exist in this file)
- Test: `functions/test/schemas.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `functions/test/schemas.test.ts` (extend the existing import line from `../src/schemas.js` with `verificationBody`):

```ts
describe("verificationBody", () => {
  it("accepts a minimal verification", () => {
    expect(verificationBody.safeParse({ scenarioId: "s1", testRunId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", verdict: "confirmed" }).success).toBe(true);
  });
  it("accepts an UPPERCASE ULID testRunId (deliberately NOT idPattern)", () => {
    expect(verificationBody.safeParse({ scenarioId: "s1", testRunId: "01HZXYABCDEF0123456789ABCD", verdict: "refuted" }).success).toBe(true);
  });
  it("accepts the optional fields", () => {
    expect(verificationBody.safeParse({ scenarioId: "s1", taskId: "t1", testRunId: "01A", verdict: "confirmed", summary: "npm test → 6/6", by: "verifier" }).success).toBe(true);
  });
  it("rejects an unknown verdict", () => {
    expect(verificationBody.safeParse({ scenarioId: "s1", testRunId: "01A", verdict: "maybe" }).success).toBe(false);
  });
  it("rejects a missing or empty testRunId", () => {
    expect(verificationBody.safeParse({ scenarioId: "s1", verdict: "confirmed" }).success).toBe(false);
    expect(verificationBody.safeParse({ scenarioId: "s1", testRunId: "", verdict: "confirmed" }).success).toBe(false);
  });
  it("rejects a non-idPattern scenarioId", () => {
    expect(verificationBody.safeParse({ scenarioId: "Bad Id", testRunId: "01A", verdict: "confirmed" }).success).toBe(false);
  });
  it("rejects a summary over 100KB", () => {
    const big = "x".repeat(100 * 1024 + 1);
    expect(verificationBody.safeParse({ scenarioId: "s1", testRunId: "01A", verdict: "confirmed", summary: big }).success).toBe(false);
  });
  it("drops unknown keys (plain z.object)", () => {
    const parsed = verificationBody.parse({ scenarioId: "s1", testRunId: "01A", verdict: "confirmed", createdAt: "nope" });
    expect("createdAt" in parsed).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- schemas`
Expected: FAIL (`verificationBody` is not exported from `../src/schemas.js`).

- [ ] **Step 3: Implement**

In `functions/src/schemas.ts`, add immediately after the `testRunBody` declaration (~line 124):

```ts
export const verificationBody = z.object({
  scenarioId: id,
  taskId: id.optional(),
  testRunId: z.string().min(1),          // server ULIDs are uppercase — NOT idPattern
  verdict: z.enum(["confirmed", "refuted"]),
  summary: z.string().max(CONTENT_MAX_BYTES, "verification.summary exceeds 100KB").optional(),
  by: z.string().min(1).optional(),
});
export type VerificationBody = z.infer<typeof verificationBody>;
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- schemas`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/schemas.ts functions/test/schemas.test.ts
git commit -m "feat(contract): verificationBody schema (verdict enum, ULID testRunId)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `appendVerification` service

**Files:**
- Modify: `functions/src/services/events.ts` (add a fourth appender after `appendRevision`)
- Test: `functions/test/verifications.test.ts` (new file)

- [ ] **Step 1: Write the failing tests**

`functions/test/verifications.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import "./helpers.js";
import { seedMember } from "./helpers.js";
import { db } from "../src/firestore.js";
import { appendVerification } from "../src/services/events.js";
import { upsertLoop } from "../src/services/loops.js";

async function seedProject(teamId = "team1", slug = "acme") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
  await seedMember(teamId);
  await db().doc(`teams/${teamId}/projects/${slug}`).set({ title: "Acme", status: "running" });
}

describe("appendVerification (service)", () => {
  it("writes project-direct with by: 'verifier' default and conditional keys absent", async () => {
    await seedProject();
    const id = await appendVerification("team1", "acme", { scenarioId: "s1", testRunId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", verdict: "confirmed" });
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // server ULID
    const d = (await db().doc(`teams/team1/projects/acme/verifications/${id}`).get()).data()!;
    expect(d.scenarioId).toBe("s1");
    expect(d.testRunId).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(d.verdict).toBe("confirmed");
    expect(d.by).toBe("verifier"); // default
    expect(d.createdAt).toBeDefined();
    expect("taskId" in d).toBe(false);   // omitted → key absent (byte-stable)
    expect("summary" in d).toBe(false);
  });

  it("stores taskId, summary, and an explicit by when provided", async () => {
    await seedProject();
    const id = await appendVerification("team1", "acme", { scenarioId: "s1", taskId: "t1", testRunId: "01A", verdict: "refuted", summary: "npm test → 4/6", by: "ci" });
    const d = (await db().doc(`teams/team1/projects/acme/verifications/${id}`).get()).data()!;
    expect(d.taskId).toBe("t1");
    expect(d.summary).toBe("npm test → 4/6");
    expect(d.by).toBe("ci");
  });

  it("writes loop-scoped under loops/l1/verifications", async () => {
    await seedProject();
    await upsertLoop("team1", "acme", "l1", { goal: "g", order: 1, status: "running" });
    const id = await appendVerification("team1", "acme", { scenarioId: "s1", testRunId: "01A", verdict: "confirmed" }, "l1");
    expect((await db().doc(`teams/team1/projects/acme/loops/l1/verifications/${id}`).get()).exists).toBe(true);
    expect((await db().doc(`teams/team1/projects/acme/verifications/${id}`).get()).exists).toBe(false);
  });

  it("404s when the loop does not exist", async () => {
    await seedProject();
    await expect(appendVerification("team1", "acme", { scenarioId: "s1", testRunId: "01A", verdict: "confirmed" }, "ghost"))
      .rejects.toMatchObject({ httpStatus: 404 });
  });

  it("404s when the project does not exist", async () => {
    await db().doc("teams/team1").set({ name: "T", createdBy: "u1" });
    await seedMember("team1");
    await expect(appendVerification("team1", "ghost", { scenarioId: "s1", testRunId: "01A", verdict: "confirmed" }))
      .rejects.toMatchObject({ httpStatus: 404 });
  });
});
```

> Note: `AppError` carries `httpStatus`, so `.rejects.toMatchObject({ httpStatus: 404 })` matches how `events.test.ts` asserts loop-scoped failures. The 404s come from `resolveBase` — no new error handling needed.

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- verifications`
Expected: FAIL (`appendVerification` is not exported from `../src/services/events.js`).

- [ ] **Step 3: Implement**

In `functions/src/services/events.ts`: extend the type-only import to `import type { ScoreBody, TestRunBody, RevisionBody, VerificationBody } from "../schemas.js";` and add after `appendRevision`:

```ts
export async function appendVerification(teamId: string, slug: string, body: VerificationBody, loopId?: string): Promise<string> {
  const { baseRef } = await resolveBase(teamId, slug, loopId);
  const id = ulid();
  // No transaction needed: the id is server-generated (no write-write conflict) and no derived fields are updated.
  const data: Record<string, unknown> = {
    scenarioId: body.scenarioId,
    testRunId: body.testRunId,
    verdict: body.verdict,
    by: body.by ?? "verifier",
    createdAt: FieldValue.serverTimestamp(),
  };
  if (body.taskId !== undefined) data.taskId = body.taskId;
  if (body.summary !== undefined) data.summary = body.summary;
  await baseRef.collection("verifications").doc(id).set(data);
  return id;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- verifications`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/events.ts functions/test/verifications.test.ts
git commit -m "feat(contract): appendVerification service (base-path-aware, by: verifier default)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Verifications router + mounts

**Files:**
- Modify: `functions/src/routes/events.ts` (add `verificationsRouter` after `revisionsRouter`)
- Modify: `functions/src/app.ts` (two mounts)
- Test: extend `functions/test/verifications.test.ts` with Supertest API tests.

- [ ] **Step 1: Write the failing API tests**

Append to `functions/test/verifications.test.ts` (add the imports `request from "supertest"`, `authHeader` from `./helpers.js`, and `makeApp` from `../src/app.js` at the top, plus `const app = makeApp();` after the imports):

```ts
describe("POST verifications (API)", () => {
  it("appends via the project-direct route and returns a ULID id", async () => {
    await seedProject();
    const res = await request(app).post("/v1/teams/team1/projects/acme/verifications").set(authHeader())
      .send({ scenarioId: "s1", testRunId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", verdict: "confirmed", summary: "npm test → 6/6" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    const d = (await db().doc(`teams/team1/projects/acme/verifications/${res.body.id}`).get()).data()!;
    expect(d.testRunId).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV"); // uppercase ULID accepted end-to-end
  });

  it("appends via the loop-scoped route", async () => {
    await seedProject();
    await upsertLoop("team1", "acme", "l1", { goal: "g", order: 1, status: "running" });
    const res = await request(app).post("/v1/teams/team1/projects/acme/loops/l1/verifications").set(authHeader())
      .send({ scenarioId: "s1", testRunId: "01A", verdict: "refuted" });
    expect(res.status).toBe(200);
    expect((await db().doc(`teams/team1/projects/acme/loops/l1/verifications/${res.body.id}`).get()).exists).toBe(true);
  });

  it("400s on an unknown verdict enum", async () => {
    await seedProject();
    const res = await request(app).post("/v1/teams/team1/projects/acme/verifications").set(authHeader())
      .send({ scenarioId: "s1", testRunId: "01A", verdict: "passed" });
    expect(res.status).toBe(400);
  });

  it("404s when the project does not exist", async () => {
    await db().doc("teams/team1").set({ name: "T", createdBy: "u1" });
    await seedMember("team1");
    const res = await request(app).post("/v1/teams/team1/projects/ghost/verifications").set(authHeader())
      .send({ scenarioId: "s1", testRunId: "01A", verdict: "confirmed" });
    expect(res.status).toBe(404);
  });

  it("404s when the loop does not exist", async () => {
    await seedProject();
    const res = await request(app).post("/v1/teams/team1/projects/acme/loops/ghost/verifications").set(authHeader())
      .send({ scenarioId: "s1", testRunId: "01A", verdict: "confirmed" });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- verifications`
Expected: FAIL (the new API tests 404 with `unknown route` — no mount yet).

- [ ] **Step 3: Implement the router**

In `functions/src/routes/events.ts`: extend the schema import to `import { idPattern, scoreBody, testRunBody, revisionBody, verificationBody } from "../schemas.js";`, extend the service import to include `appendVerification`, and append after `revisionsRouter`:

```ts
export const verificationsRouter = Router({ mergeParams: true });
verificationsRouter.post("/", async (req, res, next) => {
  try {
    const { teamId, slug, loopId } = req.params as { teamId: string; slug: string; loopId?: string };
    if (!idPattern.test(teamId)) throw new AppError(400, "validation", "invalid teamId");
    if (!idPattern.test(slug)) throw new AppError(400, "validation", "invalid project slug");
    if (loopId !== undefined && !idPattern.test(loopId)) throw new AppError(400, "validation", "invalid loopId");
    const parsed = verificationBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const id = await appendVerification(teamId, slug, parsed.data, loopId);
    res.status(200).json({ ok: true, id });
  } catch (err) { next(err); }
});
```

- [ ] **Step 4: Mount in `app.ts`**

Extend the existing events import:

```ts
import { scoresRouter, testRunsRouter, revisionsRouter, verificationsRouter } from "./routes/events.js";
```

Add the **project-direct** mount immediately after `teamRouter.use("/:slug/revisions", revisionsRouter);`:

```ts
  teamRouter.use("/:slug/verifications", verificationsRouter);
```

Add the **loop-scoped** mount immediately after `teamRouter.use("/:slug/loops/:loopId/revisions", revisionsRouter);` (i.e. BEFORE `teamRouter.use("/:slug/loops", loopsRouter);`):

```ts
  teamRouter.use("/:slug/loops/:loopId/verifications", verificationsRouter);
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd functions && npm run test:run -- verifications`
Expected: PASS (service + API tests).

- [ ] **Step 6: Commit**

```bash
git add functions/src/routes/events.ts functions/src/app.ts functions/test/verifications.test.ts
git commit -m "feat(contract): verifications router + project-direct & loop-scoped mounts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Extract the `stampEndedAt` helper from `upsertPhase`

Pure refactor — no behavior change. The spec says the sweep must "reuse the phase service's stamping helper rather than duplicating it"; today that stamping is **inline** in `upsertPhase` (`functions/src/services/phases.ts:48-50`), so extract it first. The existing phases suite is the guard.

**Files:**
- Modify: `functions/src/services/phases.ts`
- Test: existing `functions/test/phases.test.ts` must stay green (the guard).

- [ ] **Step 1: Extract the helper**

In `functions/src/services/phases.ts`, add above `upsertPhase`:

```ts
/** Stamp endedAt on the FIRST terminal transition; once set it is never updated,
 *  even if the doc is re-activated and re-completed (the server does not police
 *  transitions). Shared by upsertPhase and the terminal backstop sweep. */
export function stampEndedAt(data: Record<string, unknown>, newStatus: Status, existingEndedAt: unknown): void {
  if (isTerminal(newStatus) && !existingEndedAt) data.endedAt = FieldValue.serverTimestamp();
}
```

Replace the inline block in `upsertPhase` (lines 45-50, the comment + `if (isTerminal(newStatus) && !(existing.endedAt)) { phaseData.endedAt = … }`) with:

```ts
    stampEndedAt(phaseData, newStatus, existing.endedAt);
```

- [ ] **Step 2: Run the phases suite to verify no regression**

Run: `cd functions && npm run test:run -- phases`
Expected: PASS (all existing phase tests still green, including the endedAt-once tests).

- [ ] **Step 3: Build to verify no type errors**

Run: `cd functions && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add functions/src/services/phases.ts
git commit -m "refactor(contract): extract stampEndedAt helper from upsertPhase

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Loop backstop — sweep on terminal transition in `upsertLoop`

**Files:**
- Create: `functions/src/services/backstop.ts`
- Modify: `functions/src/services/loops.ts`
- Test: `functions/test/backstop.test.ts` (new file)

- [ ] **Step 1: Write the failing tests**

`functions/test/backstop.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import "./helpers.js";
import { seedMember } from "./helpers.js";
import { db } from "../src/firestore.js";
import { upsertLoop } from "../src/services/loops.js";
import { upsertPhase } from "../src/services/phases.js";
import { upsertTask } from "../src/services/tasks.js";

async function seedProject(teamId = "team1", slug = "acme") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
  await seedMember(teamId);
  await db().doc(`teams/${teamId}/projects/${slug}`).set({ title: "Acme", status: "running" });
}

/** Loop l1 with one running phase and one task per non-terminal status, plus a failed task. */
async function seedLoopTree(loopId = "l1") {
  await seedProject();
  await upsertLoop("team1", "acme", loopId, { goal: "g", order: 1, status: "running" });
  await upsertPhase("team1", "acme", "p1", { name: "P", order: 1, status: "running" }, loopId);
  await upsertTask("team1", "acme", "t-run",     { phaseId: "p1", title: "A", order: 1, status: "running" }, loopId);
  await upsertTask("team1", "acme", "t-queued",  { phaseId: "p1", title: "B", order: 2, status: "queued"  }, loopId);
  await upsertTask("team1", "acme", "t-blocked", { phaseId: "p1", title: "C", order: 3, status: "blocked" }, loopId);
  await upsertTask("team1", "acme", "t-paused",  { phaseId: "p1", title: "D", order: 4, status: "paused"  }, loopId);
  await upsertTask("team1", "acme", "t-failed",  { phaseId: "p1", title: "E", order: 5, status: "failed"  }, loopId);
}
const loopDoc = (p: string) => db().doc(`teams/team1/projects/acme/loops/l1/${p}`);

describe("terminal backstop — loop close", () => {
  it("sweeps every non-terminal phase+task to the loop's terminal status (endedAt on phases only)", async () => {
    await seedLoopTree();
    await upsertLoop("team1", "acme", "l1", { status: "completed" });
    for (const id of ["t-run", "t-queued", "t-blocked", "t-paused"]) {
      const d = (await loopDoc(`tasks/${id}`).get()).data()!;
      expect(d.status).toBe("completed");
      expect(d.updatedAt).toBeDefined();
      expect("endedAt" in d).toBe(false); // tasks have no endedAt field
    }
    const p = (await loopDoc("phases/p1").get()).data()!;
    expect(p.status).toBe("completed");
    expect(p.endedAt).not.toBeNull();
  });

  it("nulls the loop's derived currentPhaseId/currentTaskId", async () => {
    await seedLoopTree();
    // sanity: the open phase/task are current before the close
    const before = (await db().doc("teams/team1/projects/acme/loops/l1").get()).data()!;
    expect(before.currentPhaseId).toBe("p1");
    expect(before.currentTaskId).toBe("t-run");
    await upsertLoop("team1", "acme", "l1", { status: "completed" });
    const after = (await db().doc("teams/team1/projects/acme/loops/l1").get()).data()!;
    expect(after.currentPhaseId).toBeNull();
    expect(after.currentTaskId).toBeNull();
  });

  it("leaves already-terminal docs byte-stable (failed task under a completed loop stays failed)", async () => {
    await seedLoopTree();
    const before = await loopDoc("tasks/t-failed").get();
    await upsertLoop("team1", "acme", "l1", { status: "completed" });
    const after = await loopDoc("tasks/t-failed").get();
    expect(after.data()!.status).toBe("failed"); // NOT promoted to completed
    expect(after.updateTime!.isEqual(before.updateTime!)).toBe(true); // untouched
  });

  it("is idempotent: re-PUTting completed sweeps nothing", async () => {
    await seedLoopTree();
    await upsertLoop("team1", "acme", "l1", { status: "completed" });
    const taskBefore = await loopDoc("tasks/t-run").get();
    const phaseBefore = await loopDoc("phases/p1").get();
    await upsertLoop("team1", "acme", "l1", { status: "completed" }); // completed → completed: no transition
    expect((await loopDoc("tasks/t-run").get()).updateTime!.isEqual(taskBefore.updateTime!)).toBe(true);
    expect((await loopDoc("phases/p1").get()).updateTime!.isEqual(phaseBefore.updateTime!)).toBe(true);
    const loop = (await db().doc("teams/team1/projects/acme/loops/l1").get()).data()!;
    expect(loop.currentPhaseId).toBeNull(); // pointers stay null
    expect(loop.currentTaskId).toBeNull();
  });

  it("maps cancelled → cancelled (honest semantics, same terminal status as the loop)", async () => {
    await seedLoopTree();
    await upsertLoop("team1", "acme", "l1", { status: "cancelled" });
    expect((await loopDoc("tasks/t-run").get()).data()!.status).toBe("cancelled");
    expect((await loopDoc("phases/p1").get()).data()!.status).toBe("cancelled");
    expect((await loopDoc("tasks/t-failed").get()).data()!.status).toBe("failed"); // already terminal: untouched
  });

  it("sweeps nothing on a non-terminal write", async () => {
    await seedLoopTree();
    await upsertLoop("team1", "acme", "l1", { status: "paused" });
    expect((await loopDoc("tasks/t-run").get()).data()!.status).toBe("running");
    expect((await loopDoc("phases/p1").get()).data()!.status).toBe("running");
    const loop = (await db().doc("teams/team1/projects/acme/loops/l1").get()).data()!;
    expect(loop.currentPhaseId).toBe("p1"); // pointers untouched
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- backstop`
Expected: FAIL (tasks stay `running` after the close; pointers stay `p1`/`t-run`).

- [ ] **Step 3: Implement the sweep helper**

`functions/src/services/backstop.ts`:

```ts
import { FieldValue } from "firebase-admin/firestore";
import { isTerminal, type Status } from "../status.js";
import { stampEndedAt } from "./phases.js";

type DocRef = FirebaseFirestore.DocumentReference;

/**
 * Deterministic backstop: when a loop (or the project, for project-direct data)
 * transitions INTO a terminal status, set every non-terminal phase/task under
 * baseRef to that SAME terminal status and null the derived
 * currentPhaseId/currentTaskId pointers on the base doc — the well-behaved close
 * path ends with both pointers null via the derive.ts recomputes, and the sweep
 * must land in the same end state so the UI stops rendering a "current" task.
 *
 * Best-effort and post-transaction: the close itself never fails because the
 * sweep failed — log and continue (consistent with the API's write-only,
 * agent-trusting posture). Batched writes of ≤500.
 */
export async function sweepToTerminal(baseRef: DocRef, terminalStatus: Status): Promise<void> {
  try {
    const [phasesSnap, tasksSnap] = await Promise.all([
      baseRef.collection("phases").get(),
      baseRef.collection("tasks").get(),
    ]);
    const writes: Array<{ ref: DocRef; data: Record<string, unknown> }> = [];
    for (const d of phasesSnap.docs) {
      if (isTerminal(d.data().status as Status)) continue; // already-terminal docs stay byte-stable
      const data: Record<string, unknown> = { status: terminalStatus, updatedAt: FieldValue.serverTimestamp() };
      stampEndedAt(data, terminalStatus, d.data().endedAt); // phases only — tasks have no endedAt field
      writes.push({ ref: d.ref, data });
    }
    for (const d of tasksSnap.docs) {
      if (isTerminal(d.data().status as Status)) continue;
      writes.push({ ref: d.ref, data: { status: terminalStatus, updatedAt: FieldValue.serverTimestamp() } });
    }
    writes.push({ ref: baseRef, data: { currentPhaseId: null, currentTaskId: null, updatedAt: FieldValue.serverTimestamp() } });
    while (writes.length > 0) {
      const chunk = writes.splice(0, 500);
      const batch = baseRef.firestore.batch();
      for (const w of chunk) batch.set(w.ref, w.data, { merge: true });
      await batch.commit();
    }
  } catch (e) {
    console.error("backstop sweep failed (the terminal close itself was already applied):", e);
  }
}
```

- [ ] **Step 4: Hook it into `upsertLoop`**

In `functions/src/services/loops.ts`, add the import `import { sweepToTerminal } from "./backstop.js";` and change `upsertLoop` to detect the transition inside the existing transaction and sweep after it:

```ts
export async function upsertLoop(teamId: string, slug: string, loopId: string, body: LoopBody): Promise<void> {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const loopRef = projectRef.collection("loops").doc(loopId);
  // Terminal-transition flag, carried OUT of the transaction: the sweep runs after
  // the commit. Reassigned (not just narrowed) on every attempt, so tx retries stay correct.
  let sweepStatus: Status | null = null;
  await db().runTransaction(async (tx) => {
    // --- all reads first ---
    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists) throw new AppError(404, "not_found", "project does not exist");
    const loopSnap = await tx.get(loopRef);
    const loopsSnap = await tx.get(projectRef.collection("loops"));

    const creating = !loopSnap.exists;
    if (creating && (body.goal === undefined || body.order === undefined || body.status === undefined)) {
      throw new AppError(400, "validation", "goal, order and status are required when creating a loop");
    }
    const existing = loopSnap.data() ?? {};
    const newStatus: Status = (body.status ?? existing.status) as Status;
    const newOrder: number = (body.order ?? existing.order) as number;

    // Transition INTO terminal: was non-terminal (or absent) before, terminal after.
    const wasTerminal = !creating && existing.status !== undefined && isTerminal(existing.status as Status);
    sweepStatus = isTerminal(newStatus) && !wasTerminal ? newStatus : null;

    const data: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (creating) { data.startedAt = FieldValue.serverTimestamp(); data.endedAt = null; }
    if (body.goal !== undefined) data.goal = body.goal;
    if (body.name !== undefined) data.name = body.name;
    if (body.order !== undefined) data.order = body.order;
    if (body.status !== undefined) data.status = body.status;
    // endedAt = the FIRST terminal transition; once set it is never updated.
    if (isTerminal(newStatus) && !existing.endedAt) data.endedAt = FieldValue.serverTimestamp();

    // --- recompute currentLoopId from the full loop set with this write applied ---
    const loops = loopsSnap.docs.filter((d) => d.id !== loopId)
      .map((d) => ({ id: d.id, order: d.data().order as number, status: d.data().status as Status }));
    loops.push({ id: loopId, order: newOrder, status: newStatus });
    const currentLoopId = computeCurrentLoopId(loops);

    tx.set(loopRef, data, { merge: true });
    tx.set(projectRef, { currentLoopId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  // Post-tx, best-effort: sweepToTerminal never throws (it logs and continues).
  if (sweepStatus !== null) await sweepToTerminal(loopRef, sweepStatus);
}
```

(Only the `sweepStatus` declaration, the `wasTerminal`/`sweepStatus` lines, and the trailing `if` are new — the rest of the body is byte-identical to today's.)

- [ ] **Step 5: Run to verify it passes**

Run: `cd functions && npm run test:run -- backstop`
Expected: PASS.

- [ ] **Step 6: Run the loops suite to verify no regression**

Run: `cd functions && npm run test:run -- loops`
Expected: PASS (the currentLoopId-advance test closes loops with empty subcollections — the sweep is a no-op there apart from the already-null pointers).

- [ ] **Step 7: Commit**

```bash
git add functions/src/services/backstop.ts functions/src/services/loops.ts functions/test/backstop.test.ts
git commit -m "feat(contract): deterministic backstop — loop terminal close sweeps non-terminal phases/tasks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Project-direct backstop (implicit `main` loop) via `upsertProject`

The web's user project route cannot terminal-close a loop-owned project (`assertWebEditable` blocks it), so the agent PUT path — `upsertProject` — is the sole writer that can trigger the project-direct sweep. `applyProjectUpsert` gains a return value (the terminal status when this write transitions the project into terminal, else `null`); the `userProjects` route keeps calling it and simply ignores the return.

**Files:**
- Modify: `functions/src/services/projects.ts`
- Test: extend `functions/test/backstop.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `functions/test/backstop.test.ts` (add `import { upsertProject } from "../src/services/projects.js";` to the imports):

```ts
describe("terminal backstop — project-direct (implicit main loop)", () => {
  const projDoc = (p: string) => db().doc(`teams/team1/projects/acme/${p}`);

  async function seedProjectDirectTree() {
    await seedProject();
    await upsertPhase("team1", "acme", "p1", { name: "P", order: 1, status: "running" });
    await upsertTask("team1", "acme", "t1", { phaseId: "p1", title: "T", order: 1, status: "running" });
  }

  it("project terminal transition sweeps project-direct phases/tasks and nulls the project pointers", async () => {
    await seedProjectDirectTree();
    await upsertProject("team1", "acme", { status: "completed" });
    expect((await projDoc("tasks/t1").get()).data()!.status).toBe("completed");
    const p = (await projDoc("phases/p1").get()).data()!;
    expect(p.status).toBe("completed");
    expect(p.endedAt).not.toBeNull();
    const proj = (await db().doc("teams/team1/projects/acme").get()).data()!;
    expect(proj.currentPhaseId).toBeNull();
    expect(proj.currentTaskId).toBeNull();
  });

  it("non-terminal project writes sweep nothing", async () => {
    await seedProjectDirectTree();
    await upsertProject("team1", "acme", { status: "paused" });
    expect((await projDoc("tasks/t1").get()).data()!.status).toBe("running");
    expect((await projDoc("phases/p1").get()).data()!.status).toBe("running");
  });

  it("re-PUTting completed is idempotent (no transition, no sweep)", async () => {
    await seedProjectDirectTree();
    await upsertProject("team1", "acme", { status: "completed" });
    const before = await projDoc("tasks/t1").get();
    await upsertProject("team1", "acme", { status: "completed" });
    expect((await projDoc("tasks/t1").get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- backstop`
Expected: FAIL (the project-direct task stays `running` after the project completes).

- [ ] **Step 3: Implement**

In `functions/src/services/projects.ts`, add the imports:

```ts
import { isTerminal, type Status } from "../status.js";
import { sweepToTerminal } from "./backstop.js";
```

Change `applyProjectUpsert` to compute and return the transition (signature change: `Promise<void>` → `Promise<Status | null>`; everything else is unchanged):

```ts
/** Apply a project upsert within an OPEN transaction. Reads teamRef + ref before any write.
 *  Stamps visionOwner only when `owner` is provided (a bare project set does not stamp).
 *  Returns the terminal status when THIS write transitions the project into a terminal
 *  status (consumed by upsertProject's backstop sweep), else null. */
export async function applyProjectUpsert(tx: Tx, teamRef: Ref, ref: Ref, slug: string, body: ProjectBody, owner?: "web" | "loop"): Promise<Status | null> {
  const teamSnap = await tx.get(teamRef);
  if (!teamSnap.exists) throw new AppError(404, "not_found", "team does not exist");
  const snap = await tx.get(ref);
  const creating = !snap.exists;
  if (creating && (!body.title || !body.status)) {
    throw new AppError(400, "validation", "title and status are required when creating a project");
  }
  const existing = snap.data() ?? {};
  const newStatus = (body.status ?? existing.status) as Status | undefined;
  const wasTerminal = !creating && existing.status !== undefined && isTerminal(existing.status as Status);

  const data: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (creating) { data.slug = slug; data.createdAt = FieldValue.serverTimestamp(); data.currentPhaseId = null; }
  if (body.title !== undefined) data.title = body.title;
  if (body.status !== undefined) data.status = body.status;
  if (body.design !== undefined) data.design = { ...body.design, updatedAt: FieldValue.serverTimestamp() };
  if (owner !== undefined) data.visionOwner = owner;
  tx.set(ref, data, { merge: true });
  return newStatus !== undefined && isTerminal(newStatus) && !wasTerminal ? newStatus : null;
}

export async function upsertProject(teamId: string, slug: string, body: ProjectBody): Promise<void> {
  const teamRef = db().doc(`teams/${teamId}`);
  const ref = db().doc(`teams/${teamId}/projects/${slug}`);
  const sweepStatus = await db().runTransaction((tx) => applyProjectUpsert(tx, teamRef, ref, slug, body)); // owner undefined: bare project set doesn't stamp
  // Project-direct data = the implicit `main` loop; same best-effort post-tx sweep as upsertLoop.
  if (sweepStatus !== null) await sweepToTerminal(ref, sweepStatus);
}
```

(`functions/src/routes/userProjects.ts` needs no change — it awaits `applyProjectUpsert` and discards the new return value.)

- [ ] **Step 4: Run to verify it passes, with no regressions**

Run: `cd functions && npm run test:run -- backstop && npm run test:run -- projects && npm run test:run -- userProjects && npm run test:run -- visionOwner`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/projects.ts functions/test/backstop.test.ts
git commit -m "feat(contract): project-direct backstop sweep on project terminal transition

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Rules tests for the verifications subtree

No rules change (the recursive `match /projects/{slug}/{document=**}` already covers `verifications/{id}` and `loops/{id}/verifications/{id}`). Add tests asserting member-read / non-member-deny / client-write-deny on both paths.

**Files:**
- Modify: `functions/test-rules/rules.test.ts` (extend `seedProjectTree` + the two `paths` arrays)

- [ ] **Step 1: Seed verification docs in `seedProjectTree`**

In `functions/test-rules/rules.test.ts`, inside `seedProjectTree`, add a project-direct verification (after the `testRuns/01DEF` line):

```ts
    await fs.doc(`teams/${teamId}/projects/web/verifications/01VRF`).set({ scenarioId: "s1", testRunId: "01DEF", verdict: "confirmed", by: "verifier" });
```

and a loop-scoped one (after the `loops/l1/scores/01XYZ` line):

```ts
    await fs.doc(`teams/${teamId}/projects/web/loops/l1/verifications/01VRF`).set({ scenarioId: "s1", testRunId: "01DEF", verdict: "confirmed", by: "verifier" });
```

- [ ] **Step 2: Add the paths to the two describe blocks**

In `describe("rules: loop-contract subcollections", …)` add `"verifications/01VRF"` to its `paths` array. In `describe("rules: loop subcollections", …)` add `"loops/l1/verifications/01VRF"` to its `paths` array. (Both blocks already assert read-allow for members, read-deny for non-members, and write-deny for owners over every path.)

- [ ] **Step 3: Run the rules suite**

Run: `cd functions && npm run test:rules`
Expected: PASS (the verification paths are member-readable, non-member-denied, client-write-denied — covered by the recursive rule with no rules change).

- [ ] **Step 4: Commit**

```bash
git add functions/test-rules/rules.test.ts
git commit -m "test(rules): cover verifications subtree (member-read, client-write-deny)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: CLI `verify` verb (+ surface returned event ids)

`verify` is a one-word verb taking a positional `<scenarioId>`, like `score`/`test-run`. The driver flow needs each test-run's server ULID to pass as `--test-run`, but `report()` currently swallows the response body — so this task also makes `report()` print `autoloop: id <ULID>` (on the informational `err` channel, like the pending-messages notice) whenever the response carries an id. **Note:** this `report()` line is the minimal enabling change for the spec's driver flow ("collect each scenario's latest test-run id"); the spec does not name it explicitly, but without it the driver cannot learn the ULID it must pass to `autoloop verify --test-run`. Deliberate, reviewed scope addition.

**Files:**
- Modify: `cli/autoloop.mjs` (add `"verify"` to `ONE_WORD` ~line 274; add the `case "verify"` after `case "test-run"` ~line 548; add the id print in `report()` ~line 105)
- Test: `functions/test/cli.unit.test.ts` (new describe block)

- [ ] **Step 1: Write the failing tests**

Add a describe block to `functions/test/cli.unit.test.ts` (model on the "bug add/set verbs" block — same `initDir`/`cap`/`base` shape):

```ts
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

  it("event verbs surface the server id (autoloop: id <ULID>)", async () => {
    const dir = initDir(); const c = cap(); const errs: string[] = [];
    await run(["test-run", "s1", "--task", "t1", "--passed", "1", "--failed", "0"],
      { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: (m: string) => errs.push(m), fetchImpl: c.fetchImpl });
    expect(errs.some((m) => m.includes("id 01XYZ"))).toBe(true);
  });
});
```

> `tmp`, `saveConfig`, `run`, `writeFileSync`, `join` are already imported at the top of `cli.unit.test.ts` — reuse them. A `UsageError` makes `run` return a non-zero exit code, which is what the rejection tests assert.

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: FAIL (`verify` hits the default unknown-command path; the id-print test finds no matching message).

- [ ] **Step 3: Implement**

In `cli/autoloop.mjs`:

1. Add `"verify"` to the one-word verb set (~line 274):

```js
    const ONE_WORD = new Set(["init", "commit", "score", "test-run", "revise", "verify"]);
```

2. Add the case immediately after `case "test-run"` (before `case "revise"`):

```js
      case "verify": {
        oneFlag("test-run", flags["test-run"]); oneFlag("verdict", flags.verdict);
        const scenarioId = positionals[1]; validateId("scenarioId", scenarioId);
        if (!flags["test-run"]) throw new UsageError("verify requires --test-run <testRunId>");
        if (!["confirmed", "refuted"].includes(flags.verdict)) throw new UsageError(`--verdict must be confirmed|refuted, got '${flags.verdict}'`);
        // testRunId is a server ULID (uppercase) — deliberately NOT validateId'd.
        const body = { scenarioId, testRunId: String(flags["test-run"]), verdict: flags.verdict };
        if (flags.task) { validateId("task", flags.task); body.taskId = flags.task; }
        if (flags["summary-file"]) {
          try { body.summary = readFileSync(join(cwd, flags["summary-file"]), "utf8"); }
          catch (e) { throw new UsageError(`could not read --summary-file '${flags["summary-file"]}': ${e.message}`); }
        } else if (flags.summary) {
          body.summary = flags.summary;
        }
        const cfg = loadConfig(cwd);
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}${loopSeg(cfg)}/verifications`;
        return report({ method: "POST", url, body },
          { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
```

3. In `report()` (the `if (res.ok)` branch, inside the existing `try` after the `pendingMessages` check, ~line 108), add:

```js
      if (typeof b?.id === "string") err(`autoloop: id ${b.id}`);
```

- [ ] **Step 4: Run to verify it passes, with no CLI regressions**

Run: `cd functions && npm run test:run -- cli.unit && npm run test:run -- cli.integration`
Expected: PASS (existing happy-path tests pass `err: () => {}`, so the extra informational line is inert).

- [ ] **Step 5: Commit**

```bash
git add cli/autoloop.mjs functions/test/cli.unit.test.ts
git commit -m "feat(cli): verify verb (loop-aware, --summary/--summary-file) + surface server event ids

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Web data layer — `Verification` type, `useVerifications`, pure `verificationView.ts`

**Files:**
- Modify: `web/src/dashboard/types.ts`
- Modify: `web/src/dashboard/hooks.ts` (add `useVerifications` after `useTestRuns`, ~line 165)
- Create: `web/src/dashboard/verificationView.ts`
- Test: `web/src/dashboard/verificationView.test.ts` (new file)

- [ ] **Step 1: Write the failing tests**

`web/src/dashboard/verificationView.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { verdictForTestRun, scenarioVerification } from "./verificationView";
import type { Verification } from "./types";

const v = (id: string, testRunId: string, verdict: "confirmed" | "refuted", scenarioId = "s1"): Verification =>
  ({ id, scenarioId, testRunId, verdict });

describe("verdictForTestRun", () => {
  it("returns the verdict of the latest (highest-id) verification for that run", () => {
    expect(verdictForTestRun("01A", [v("01V", "01A", "confirmed"), v("01W", "01A", "refuted")])).toBe("refuted");
    expect(verdictForTestRun("01A", [v("01W", "01A", "refuted"), v("01X", "01A", "confirmed")])).toBe("confirmed");
  });
  it("ignores verifications for other runs", () => {
    expect(verdictForTestRun("01A", [v("01V", "01B", "refuted")])).toBeUndefined();
  });
  it("returns undefined when there are none", () => {
    expect(verdictForTestRun("01A", [])).toBeUndefined();
  });
});

describe("scenarioVerification", () => {
  it("resolves the verdict for the scenario's LATEST test-run only", () => {
    // 01B is the latest run; a confirmed verdict on the older 01A does not count
    expect(scenarioVerification("s1", "01B", [v("01V", "01A", "confirmed")])).toBeUndefined();
    expect(scenarioVerification("s1", "01B", [v("01V", "01B", "refuted")])).toBe("refuted");
  });
  it("ignores other scenarios' verifications", () => {
    expect(scenarioVerification("s1", "01A", [v("01V", "01A", "confirmed", "other")])).toBeUndefined();
  });
  it("returns undefined when the scenario has no test-run", () => {
    expect(scenarioVerification("s1", null, [v("01V", "01A", "confirmed")])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npm test`
Expected: FAIL (`./verificationView` does not exist; `Verification` is not exported from `./types`).

- [ ] **Step 3: Implement**

Add to `web/src/dashboard/types.ts` (after the `TestRun` interface):

```ts
export interface Verification {
  id: string; scenarioId?: string; taskId?: string; testRunId?: string;
  verdict?: "confirmed" | "refuted"; summary?: string; by?: string; createdAt?: unknown;
}
```

Create `web/src/dashboard/verificationView.ts`:

```ts
import type { Verification } from "./types";
import { latestById } from "./scenarioState";

export type VerificationVerdict = "confirmed" | "refuted";

/** Verdict of the latest (highest ULID id) verification targeting this test-run; undefined when unverified. */
export function verdictForTestRun(testRunId: string, verifications: Verification[]): VerificationVerdict | undefined {
  return latestById(verifications.filter((v) => v.testRunId === testRunId))?.verdict;
}

/** Scenario-level badge verdict: the verdict for the scenario's LATEST test-run.
 *  A verification of an older run does not count — only the latest run's evidence matters. */
export function scenarioVerification(scenarioId: string, latestTestRunId: string | null, verifications: Verification[]): VerificationVerdict | undefined {
  if (!latestTestRunId) return undefined;
  return verdictForTestRun(latestTestRunId, verifications.filter((v) => v.scenarioId === scenarioId));
}
```

Add to `web/src/dashboard/hooks.ts` directly after `useTestRuns` (extend the `types` import with `Verification`):

```ts
export function useVerifications(teamId: string, slug: string, loopId?: string): Result<Verification[]> {
  const [data, setData] = useState<Verification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, ...basePath(teamId, slug, loopId), "verifications"), orderBy(documentId()));
    return onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Verification[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId, slug, loopId]);
  return { data, loading, error };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npm test`
Expected: PASS (including the untouched `scenarioState.test.ts` — met-state derivation is unchanged).

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard/types.ts web/src/dashboard/hooks.ts web/src/dashboard/verificationView.ts web/src/dashboard/verificationView.test.ts
git commit -m "feat(web): Verification type, useVerifications hook, pure verificationView

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Web badges — TestRunsSection, ScenarioCard, ScenarioTable (+ wiring)

A shared `VerificationBadge` renders the three states; `verifications` is an **optional** prop everywhere (default `[]`), so every existing call site and test stays valid. Met-state text/derivation (`scenarioState.ts`) is untouched.

**Files:**
- Create: `web/src/dashboard/components/VerificationBadge.tsx`
- Modify: `web/src/dashboard/components/TestRunsSection.tsx`
- Modify: `web/src/dashboard/components/ScenarioCard.tsx`
- Modify: `web/src/dashboard/components/ScenarioTable.tsx`
- Modify (prop threading): `web/src/dashboard/components/VisionSection.tsx`, `web/src/dashboard/components/LoopDetail.tsx`, `web/src/dashboard/tabs/LoopsTab.tsx`, `web/src/dashboard/tabs/VisionTab.tsx`, `web/src/dashboard/ProjectDetail.tsx`
- Modify: `web/src/index.css` (badge styles, after the `.scnbadge` block ~line 820)
- Test: `web/src/dashboard/components/loops.test.tsx`, `web/src/dashboard/components/vision.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `web/src/dashboard/components/loops.test.tsx` (inside the `TestRunsSection` describe; extend the type import with `Verification` from `../types` if needed):

```tsx
  it("shows ✓ Verified / ✗ Refuted per the latest verification, nothing when unverified", () => {
    const runs = [{ id: "01A", passed: 8, failed: 0 }];
    const { rerender } = render(<TestRunsSection testRuns={runs}
      verifications={[{ id: "01V", testRunId: "01A", verdict: "confirmed" }]} />);
    expect(screen.getByText("✓ Verified")).toBeInTheDocument();
    rerender(<TestRunsSection testRuns={runs}
      verifications={[{ id: "01V", testRunId: "01A", verdict: "confirmed" }, { id: "01W", testRunId: "01A", verdict: "refuted" }]} />);
    expect(screen.getByText("✗ Refuted")).toBeInTheDocument(); // latest (01W) wins
    rerender(<TestRunsSection testRuns={runs} verifications={[]} />);
    expect(screen.queryByText(/Verified|Refuted/)).toBeNull(); // nothing when unverified
  });
```

Add to `web/src/dashboard/components/vision.test.tsx` (import `ScenarioTable` from `./ScenarioTable` and extend the type import with `Verification`):

```tsx
describe("scenario verification badges", () => {
  const scores: Score[] = [{ id: "01A", scenarioId: "login", composite: 92 }];
  const runs: TestRun[] = [{ id: "01A", scenarioId: "login", passed: 6, failed: 0 }];
  const confirmed: Verification[] = [{ id: "01V", scenarioId: "login", testRunId: "01A", verdict: "confirmed" }];

  it("ScenarioCard shows a small ✓ when the latest test-run is confirmed", () => {
    render(<ScenarioCard scenario={scn} scores={scores} testRuns={runs} verifications={confirmed} />);
    expect(screen.getByTitle("Independently verified")).toHaveTextContent("✓");
  });
  it("ScenarioCard shows ⚠ Unverified when the latest run has no verification", () => {
    render(<ScenarioCard scenario={scn} scores={scores} testRuns={runs} verifications={[]} />);
    expect(screen.getByText("⚠ Unverified")).toBeInTheDocument();
  });
  it("ScenarioCard shows ✗ when the latest run is refuted; met-state text is unchanged", () => {
    render(<ScenarioCard scenario={scn} scores={scores} testRuns={runs}
      verifications={[{ id: "01V", scenarioId: "login", testRunId: "01A", verdict: "refuted" }]} />);
    expect(screen.getByTitle("Independent replay refuted this result")).toHaveTextContent("✗");
    expect(screen.getByText("met")).toBeInTheDocument(); // verification is evidence, not a gate
  });
  it("ScenarioCard treats a verification of an OLDER run as unverified", () => {
    const twoRuns: TestRun[] = [...runs, { id: "01B", scenarioId: "login", passed: 6, failed: 0 }];
    render(<ScenarioCard scenario={scn} scores={scores} testRuns={twoRuns} verifications={confirmed} />);
    expect(screen.getByText("⚠ Unverified")).toBeInTheDocument(); // 01B is latest, unverified
  });
  it("ScenarioTable renders the compact badge in the status cell", () => {
    render(<ScenarioTable scenarios={[scn]} scores={scores} testRuns={runs} verifications={confirmed} />);
    expect(screen.getByTitle("Independently verified")).toHaveTextContent("✓");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npm test`
Expected: FAIL (TS rejects the unknown `verifications` prop / badges not rendered).

- [ ] **Step 3: Implement the badge component**

`web/src/dashboard/components/VerificationBadge.tsx`:

```tsx
import type { VerificationVerdict } from "../verificationView";

const LABELS = {
  confirmed: { cls: "confirmed", title: "Independently verified",                full: "✓ Verified", glyph: "✓" },
  refuted:   { cls: "refuted",   title: "Independent replay refuted this result", full: "✗ Refuted",  glyph: "✗" },
} as const;

/** Verification badge layer (evidence, not a gate — met-state is untouched).
 *  compact: glyph-only (scenario card/table). showUnverified: render ⚠ Unverified
 *  when there is no verdict (scenario level); test-run rows render nothing instead. */
export function VerificationBadge({ verdict, compact = false, showUnverified = false }: {
  verdict: VerificationVerdict | undefined; compact?: boolean; showUnverified?: boolean;
}) {
  if (!verdict) {
    if (!showUnverified) return null;
    return <span className="verifybadge verifybadge--unverified" title="Not independently verified">⚠ Unverified</span>;
  }
  const l = LABELS[verdict];
  return <span className={`verifybadge verifybadge--${l.cls}`} title={l.title}>{compact ? l.glyph : l.full}</span>;
}
```

- [ ] **Step 4: Add the badge to the three components**

`web/src/dashboard/components/TestRunsSection.tsx` — replace the file contents with:

```tsx
import type { TestRun, Verification } from "../types";
import { verdictForTestRun } from "../verificationView";
import { VerificationBadge } from "./VerificationBadge";

export function TestRunsSection({ testRuns, verifications = [] }: { testRuns: TestRun[]; verifications?: Verification[] }) {
  if (testRuns.length === 0) return null;
  const sorted = [...testRuns].sort((a, b) => (a.id < b.id ? 1 : -1)); // latest (highest id) first
  return (
    <section>
      <div className="proj-section-head"><h2 className="proj-section-title">Test runs</h2></div>
      <ul className="testruns">
        {sorted.map((r) => (
          <li key={r.id} className="testrun card">
            <div className="testrun-head">
              <span className="testrun-counts tnum">{r.passed ?? 0} passed · {r.failed ?? 0} failed</span>
              <VerificationBadge verdict={verdictForTestRun(r.id, verifications)} />
              {r.scenarioId && <span className="testrun-scn dim">{r.scenarioId}</span>}
            </div>
            {r.summary && <pre className="testrun-summary">{r.summary}</pre>}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`web/src/dashboard/components/ScenarioCard.tsx` — extend the props and the head row (everything else unchanged):

```tsx
import { deriveScenarioState, DEFAULT_THRESHOLD } from "../scenarioState";
import { scenarioVerification } from "../verificationView";
import { VerificationBadge } from "./VerificationBadge";
import type { Scenario, Score, TestRun, Verification } from "../types";

export function ScenarioCard({ scenario, scores, testRuns, verifications = [] }: {
  scenario: Scenario; scores: Score[]; testRuns: TestRun[]; verifications?: Verification[];
}) {
  const { state, latestComposite, latestTest } = deriveScenarioState(scenario, scores, testRuns);
  const verdict = scenarioVerification(scenario.id, latestTest?.id ?? null, verifications);
  ...
      <div className="scncard-head">
        <span className="scncard-title">{scenario.title ?? scenario.id}</span>
        <VerificationBadge verdict={verdict} compact showUnverified />
        <span className={`scnbadge scn-${state}`}>{state}</span>
      </div>
  ...
```

`web/src/dashboard/components/ScenarioTable.tsx` — same pattern: `ScenarioRow` and `ScenarioTable` each gain `verifications = []` (`verifications?: Verification[]`); `ScenarioTable` passes it through to each `ScenarioRow`; in `ScenarioRow` compute

```tsx
  const verdict = scenarioVerification(scenario.id, latestTest?.id ?? null, verifications);
```

and render the badge in the status cell:

```tsx
      <td className="scnrow-status">
        <span className={`scnbadge scn-${state}`}>{state}</span>{" "}
        <VerificationBadge verdict={verdict} compact showUnverified />
      </td>
```

- [ ] **Step 5: Thread the prop from ProjectDetail**

- `web/src/dashboard/components/VisionSection.tsx`: add `verifications = []` (`verifications?: Verification[]`) to the props and pass `verifications={verifications}` to both `<ScenarioTable …>` call sites.
- `web/src/dashboard/components/LoopDetail.tsx`: add `verifications = []` to the props and pass it to `<TestRunsSection testRuns={testRuns} verifications={verifications} />`.
- `web/src/dashboard/tabs/LoopsTab.tsx`: add `verifications` to the props (type `Verification[]`) and pass through to `LoopDetail`.
- `web/src/dashboard/tabs/VisionTab.tsx`: add `verifications` to the props and pass through to `VisionSection` (the non-editable branch only — `VisionEditableSection` is out of scope).
- `web/src/dashboard/ProjectDetail.tsx`: add

```tsx
  const verifications = useVerifications(teamId, slug, loopArg);
```

(extend the hooks import), pass `verifications={verifications.data}` to `LoopsTab` and `VisionTab`, and add `verifications.error` to the `dataError` chain.

- [ ] **Step 6: Badge styles**

Append to `web/src/index.css` after the `.scnbadge` block:

```css
/* verification badge (independent replay — evidence layer on top of met/unmet) */
.verifybadge {
  display: inline-flex; align-items: center;
  padding: 2px 8px; border-radius: var(--radius-full);
  font-size: 11px; font-weight: 500; white-space: nowrap; flex-shrink: 0;
}
.verifybadge--confirmed {
  color: var(--st-completed);
  background: color-mix(in oklab, var(--st-completed) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--st-completed) 30%, transparent);
}
.verifybadge--refuted {
  color: var(--st-failed);
  background: color-mix(in oklab, var(--st-failed) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--st-failed) 30%, transparent);
}
.verifybadge--unverified {
  color: var(--fg-meta);
  background: color-mix(in oklab, var(--fg-meta) 10%, transparent);
  border: 1px solid var(--border-soft);
}
```

- [ ] **Step 7: Run to verify it passes**

Run: `cd web && npm test`
Expected: PASS — the new badge tests AND every pre-existing component/scenarioState test (the prop is optional, met-state untouched).

- [ ] **Step 8: Build the web bundle to catch TS prop-threading errors**

Run: `cd web && npm run build`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add web/src/dashboard/components/VerificationBadge.tsx web/src/dashboard/components/TestRunsSection.tsx web/src/dashboard/components/ScenarioCard.tsx web/src/dashboard/components/ScenarioTable.tsx web/src/dashboard/components/VisionSection.tsx web/src/dashboard/components/LoopDetail.tsx web/src/dashboard/tabs/LoopsTab.tsx web/src/dashboard/tabs/VisionTab.tsx web/src/dashboard/ProjectDetail.tsx web/src/index.css web/src/dashboard/components/loops.test.tsx web/src/dashboard/components/vision.test.tsx
git commit -m "feat(web): Verified/Unverified/Refuted badges on test runs and scenarios

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Driver skill — verifier subagent in Step 3a + new Rule + plugin bump

**Files:**
- Modify: `plugins/autoloop/skills/autoloop/SKILL.md` (Step 3a, ~line 163; Rules list, ~line 283)
- Modify: `plugins/autoloop/.claude-plugin/plugin.json` (version `0.10.1` → `0.11.0`)
- Modify (generated): `web/public/skill/autoloop/SKILL.md` (copy)

- [ ] **Step 1: Extend Step 3a**

In `plugins/autoloop/skills/autoloop/SKILL.md`, section `### 3a. Scenario verification sweep (do this BEFORE closing)`, append after the final paragraph ("Do not close the loop with implemented-but-untested scenarios silently sitting unmet. Either they have a passing test (met) or a revision explaining why not."):

````markdown
**Independent verification (mandatory, after the sweep, before 3b):**

1. Collect, for every scenario in this loop, its **latest test-run id** — each
   `autoloop test-run` prints `autoloop: id <ULID>`; record it when you submit —
   plus the exact command and test file/names from that run's `--summary`
   (already mandatory per Traceability).
2. Dispatch **one verifier subagent** with a clean context. Its prompt contains
   ONLY the list of `{scenarioId, testRunId, command, expected pass/fail}` plus
   repo access. It replays each command and reports the actual pass/fail counts
   per scenario. It does not see the implementation conversation and calls no
   `autoloop` commands.
3. For each scenario, submit the verdict yourself:

```bash
autoloop verify <scenarioId> --test-run <testRunId> --verdict confirmed|refuted \
  [--task <taskId>] --summary "<command> → <actual result>"
```

4. A `refuted` verdict means the scenario is **unmet** regardless of its score —
   record a revision (the existing unmet path) and do not count it met in the
   closing summary.
````

- [ ] **Step 2: Add the new Rule**

In the `## Rules` list, immediately after the "**No scenario left behind.**" bullet, add:

```markdown
- **Verification is independent.** The verifier subagent never implements code and the implementer never verifies; refuted = unmet.
```

- [ ] **Step 3: Bump the plugin version**

In `plugins/autoloop/.claude-plugin/plugin.json`: `"version": "0.10.1"` → `"version": "0.11.0"`.

- [ ] **Step 4: Sync the skill copy**

Run: `cp plugins/autoloop/skills/autoloop/SKILL.md web/public/skill/autoloop/SKILL.md`
(The full sync script runs in Task 12; this keeps the skill-bump commit self-contained, matching the repo's prior skill commits.)

- [ ] **Step 5: Commit**

```bash
git add plugins/autoloop/skills/autoloop/SKILL.md plugins/autoloop/.claude-plugin/plugin.json web/public/skill/autoloop/SKILL.md
git commit -m "feat(skill): independent verifier subagent in the pre-close sweep (0.11.0)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Sync CLI copies + full gates

**Files:**
- Modify (generated): `plugins/autoloop/bin/autoloop`, `web/public/skill/autoloop.mjs` (via the sync script)

- [ ] **Step 1: Sync the CLI copies**

Run: `bash scripts/sync-autoloop-cli.sh`
Expected: prints the `✓ synced …` lines.

- [ ] **Step 2: Verify the three CLI copies and the skill copy are identical**

Run:
```bash
diff cli/autoloop.mjs plugins/autoloop/bin/autoloop && \
diff cli/autoloop.mjs web/public/skill/autoloop.mjs && \
diff plugins/autoloop/skills/autoloop/SKILL.md web/public/skill/autoloop/SKILL.md && \
echo IDENTICAL
```
Expected: `IDENTICAL` (no diff output).

- [ ] **Step 3: Functions build + full suite**

Run: `cd functions && npm run build && npm test`
Expected: build clean; ALL suites green — including the pre-existing loops/phases/projects/userProjects/events suites (no regression from the backstop hooks or the `stampEndedAt`/`applyProjectUpsert` refactors).

- [ ] **Step 4: Rules suite**

Run: `cd functions && npm run test:rules`
Expected: PASS (including the new verifications paths).

- [ ] **Step 5: Web suite**

Run: `cd web && npm test`
Expected: PASS (verificationView + badges + all pre-existing tests).

- [ ] **Step 6: Commit**

```bash
git add plugins/autoloop/bin/autoloop web/public/skill/autoloop.mjs
git commit -m "chore(cli): sync autoloop CLI copies (verify verb)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Definition of done

- `verification` events appendable via `POST …/verifications` and `POST …/loops/:loopId/verifications` (404 on missing project/loop, verdict enum enforced, uppercase ULID `testRunId` accepted, conditional `summary`/`taskId` keys absent when omitted, `by` defaults to `"verifier"`).
- Closing a loop can no longer leave its phases/tasks non-terminal: the sweep sets them to the loop's own terminal status, stamps `updatedAt` (and `endedAt` on phases only, via the shared `stampEndedAt`), nulls `currentPhaseId`/`currentTaskId`, leaves already-terminal docs byte-stable, and is idempotent. The project-direct variant fires on the project's terminal transition through `upsertProject`.
- `autoloop verify` works (loop-aware, `--summary`/`--summary-file`, verdict validated, ULID `--test-run` not lowercased-validated); event verbs print the server id; the three CLI copies are identical.
- Dashboard shows ✓ Verified / ✗ Refuted on test-run rows and ✓ / ⚠ Unverified / ✗ on scenarios (latest test-run's latest verification wins); met-state semantics (`scenarioState.ts`) byte-for-byte unchanged.
- `firestore.rules` unchanged; both verification paths member-readable and client-write-denied (tested).
- Driver skill Step 3a dispatches the clean-context verifier subagent, submits `autoloop verify` per scenario, treats refuted as unmet; new "Verification is independent" Rule; plugin at `0.11.0`; skill copy synced.
- `functions` build clean; full functions + rules + web suites pass with zero regression.

## Out of scope (per the spec)

- CI replay (GitHub Actions posting verifications with an API key) — the event shape already supports it (`by: "ci"`).
- Gating met-state on verification (verification is evidence, not a gate).
- Verifying scores/rubric judgments (only test-runs are mechanically replayable).
- An all-loops verification aggregator hook (`useAllVerifications`) — the spec defines only the single-scope `useVerifications` ("like `useTestRuns`"). Known consequence: the Vision tab derives latest test-runs from `useAllTestRuns` (cross-loop) but receives only the selected-loop/main-scope verifications, so a verification recorded in a different loop than the selected one won't badge there. Deliberate, documented limitation; fast-follow candidate.
