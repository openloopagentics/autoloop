# Loop Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Daloop's write-only reporting contract from `project → phase → commit` to the full vision-driven loop model — goals, scenarios (with rubrics), tasks (a new layer between phase and commit), task-scoped commits, documents, and append-only score/test-run/revision events — across the API, the `daloop` CLI, security-rules tests, and validation.

**Architecture:** Unchanged shape: the loop owns canonical state locally and reports one-way via the API (per-user API key → team membership); Daloop records and the website reads. Two write shapes: **entities** are idempotent `PUT` keyed by client-supplied id (goals, scenarios, tasks, commits, documents); **events** are append-only `POST` where the server stamps a sortable ULID-style id + `createdAt` (scores, testRuns, revisions). The server derives `currentPhaseId`/`currentTaskId` on relevant writes. `scenario.state` is derived by readers, never stored. No Firestore rules change (the recursive `match /projects/{slug}/{document=**}` already covers reads + write-deny); we only add rules tests.

**Tech Stack:** TypeScript Cloud Function (Express + firebase-admin + zod) in `functions/`; dependency-free Node ESM CLI in `cli/daloop.mjs`; Vitest + Firestore emulator (`functions/test/`) and `@firebase/rules-unit-testing` (`functions/test-rules/`). Node 22, no new dependencies (ULID uses `node:crypto.randomBytes`, already used by `apiKeys.ts`).

**Reference spec:** `docs/superpowers/specs/2026-06-02-loop-contract-design.md`

---

## Background / conventions (read before Task 1)

**House patterns to mirror exactly:**
- **Service layer** (`functions/src/services/*.ts`): each entity upsert runs `db().runTransaction`, reads the project doc first (404 `not_found` if missing — team existence is transitive), enforces required-on-create fields (throw `AppError(400, "validation", …)`), then `tx.set(ref, data, { merge: true })`. Server-owned fields (`createdAt`, `updatedAt`, derived ids) are set by the server, never from the client. See `services/phases.ts` and `services/projects.ts`.
- **Routes** (`functions/src/routes/*.ts`): `Router({ mergeParams: true })`; validate every path param with `idPattern.test(...)` → `AppError(400, "validation", "invalid …")`; `bodySchema.safeParse(req.body)` → on failure `AppError(400, "validation", parsed.error.issues[0].message)`; call the service; `res.status(200).json({ ok: true })`; `catch (err) { next(err); }`. See `routes/phases.ts`.
- **Schemas** (`functions/src/schemas.ts`): plain `z.object` (drops unknown keys, so client-sent server-owned fields are silently ignored). All content fields `.optional()` — required-on-create is enforced in the service layer. Export a `…Body` type via `z.infer`.
- **Mounting** (`functions/src/app.ts`): all new routes mount under the existing `teamRouter` (already guarded by `requireApiKeyMember`). **Order matters** — more specific paths first (`/:slug/tasks/:taskId/commits` before `/:slug/tasks`), and `projectsRouter` (`/`) stays last.
- **Tests** (`functions/test/*.test.ts`): Supertest against `makeApp()`; `import "./helpers.js"` registers the global `beforeEach` that clears Firestore + seeds the test API key (`TEST_KEY` → `TEST_UID`). Use `authHeader()` and `seedMember(teamId)`. Copy the `seedTeam`/`createProject` helpers from `phases.test.ts`.
- **Rules tests** (`functions/test-rules/rules.test.ts`): `@firebase/rules-unit-testing`; seed with `withSecurityRulesDisabled`, assert with `assertSucceeds`/`assertFails`.
- **CLI** (`cli/daloop.mjs`): one ESM file exposing `run(argv, deps)` returning an exit code; deps inject `cwd`, `env`, `fetchImpl`, `gitRun`, `log`, `err` for tests. `report({method,url,body}, deps)` is the best-effort request layer (warn + exit 0; exit 1 only with `--strict`/`DALOOP_STRICT=1`). `UsageError` → exit 1 before any network call. Config is `.daloop.json`.

**Commands:**
- Build (type-check, `include: ["src"]` only — never compiles `cli/` or `test/`): `cd functions && npm run build`
- Main suite (boots the emulator itself): `cd functions && npm test`
- Single main test file: `cd functions && npm run test:run -- <name>`
- Rules suite: `cd functions && npm run test:rules`
- A running emulator for ad-hoc `test:run`: `cd functions && npm run emulators` (separate shell)

**Spec decision to honor (composite):** the spec's abbreviated CLI line for `daloop score` omits the composite, but the architecture says "the agent computes everything; Daloop only records," and `scores.composite` is a stored, zod-validated (`0..100`) field. Therefore **the client sends `composite`** and the CLI gains a `--composite <n>` flag. The server does NOT recompute it. (Service-layer validation still checks per-criterion `≤ max` and that criterion keys match the rubric ids.)

**Event responses** return `{ ok: true, id }` (the server-stamped ULID) so the loop can reference the event; entity responses keep `{ ok: true }`.

**Existing CLI tests change:** making `daloop commit` task-scoped relocates the reported commit from `phases/{id}/commits/{sha}` to `tasks/{taskId}/commits/{sha}`. The CLI **unit** test (`describe("commit")` in `cli.unit.test.ts`) and the CLI **integration** test (`"init -> … -> commit"` in `cli.integration.test.ts`) currently assert the legacy phase path and MUST be updated in Tasks 8 and 14. The API-level legacy route test (`commits.test.ts`) stays unchanged — the legacy phase-scoped route is retained.

---

## File structure

| File | Responsibility | Tasks |
|---|---|---|
| `functions/src/ulid.ts` | sortable ULID-style id generator (Crockford base32, 48-bit time + random) | 1 |
| `functions/src/derive.ts` | pure `computeCurrentPhaseId` / `computeCurrentTaskId` | 2 |
| `functions/src/services/phases.ts` | refactor to use `derive.ts`; later also recompute `currentTaskId` | 2, 7 |
| `functions/src/schemas.ts` | add goal/scenario/task/document/score/testRun/revision body schemas | 3 |
| `functions/src/services/goals.ts` | `upsertGoal` | 4 |
| `functions/src/services/scenarios.ts` | `upsertScenario` | 5 |
| `functions/src/services/tasks.ts` | `upsertTask` (+ `currentTaskId` recompute) | 6 |
| `functions/src/services/taskCommits.ts` | `upsertTaskCommit` (task-scoped) | 8 |
| `functions/src/services/documents.ts` | `upsertDocument` | 9 |
| `functions/src/services/events.ts` | `appendScore` (rubric validation), `appendTestRun`, `appendRevision` | 10, 11 |
| `functions/src/routes/{goals,scenarios,tasks,taskCommits,documents,events}.ts` | route handlers | 4–11 |
| `functions/src/app.ts` | mount the new routers | 4–11 |
| `functions/test/{goals,scenarios,tasks,taskCommits,documents,events}.test.ts` | Supertest route tests | 4–11 |
| `functions/test/ulid.test.ts`, `functions/test/derive.test.ts` | pure unit tests | 1, 2 |
| `functions/test-rules/rules.test.ts` | add loop-contract subcollection read/deny tests | 12 |
| `cli/daloop.mjs` | new verbs (vision/goal/scenario/task/doc + task-aware commit + score/test-run/revise) | 13, 14 |
| `functions/test/cli.unit.test.ts`, `functions/test/cli.integration.test.ts` | CLI tests (incl. updated commit assertions) | 13, 14 |
| `web/public/skill/daloop.mjs`, `plugins/daloop-reporting/bin/daloop` | CLI distribution copies (via `scripts/sync-daloop-cli.sh`) | 14 |

---

## Task 1: ULID-style sortable id generator

**Files:**
- Create: `functions/src/ulid.ts`
- Test: `functions/test/ulid.test.ts`

- [ ] **Step 1: Write the failing test** (`functions/test/ulid.test.ts`)

```typescript
import { describe, it, expect } from "vitest";
import { ulid } from "../src/ulid.js";

describe("ulid", () => {
  it("produces a 26-char Crockford-base32 string", () => {
    const id = ulid();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("sorts lexicographically by time (earlier ms < later ms)", () => {
    const early = ulid(1_000_000_000_000);
    const late = ulid(1_700_000_000_000);
    expect(early < late).toBe(true);
  });

  it("two ids at the same ms share the 10-char time prefix but differ in the random suffix", () => {
    const a = ulid(1_700_000_000_000);
    const b = ulid(1_700_000_000_000);
    expect(a.slice(0, 10)).toBe(b.slice(0, 10));
    expect(a).not.toBe(b);
  });

  it("defaults to the current time when no arg is given", () => {
    const id = ulid();
    expect(id.length).toBe(26);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npm run test:run -- ulid`
Expected: FAIL — cannot find module `../src/ulid.js`.

- [ ] **Step 3: Write minimal implementation** (`functions/src/ulid.ts`)

```typescript
import { randomBytes } from "node:crypto";

// Crockford base32 — alphabet is in ascending ASCII order, so lexical sort == numeric sort.
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10; // 50 bits encodes a 48-bit ms timestamp with headroom
const RANDOM_LEN = 16;

/**
 * A sortable, ULID-style id: <ms timestamp, base32> + <random suffix>. Gives a total
 * order even for events committed in the same millisecond. `now` is injectable for tests.
 * Date.now() is fine in functions/src (the no-Date.now() rule is for the throwaway prototype/).
 */
export function ulid(now: number = Date.now()): string {
  let time = now;
  const timeChars: string[] = new Array(TIME_LEN);
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    timeChars[i] = ENCODING[time % 32];
    time = Math.floor(time / 32);
  }
  const rand = randomBytes(RANDOM_LEN);
  let suffix = "";
  for (let i = 0; i < RANDOM_LEN; i++) suffix += ENCODING[rand[i] % 32];
  return timeChars.join("") + suffix;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npm run test:run -- ulid`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/src/ulid.ts functions/test/ulid.test.ts
git commit -m "feat(api): sortable ULID-style id generator for loop events"
```

---

## Task 2: Derivation helpers + refactor phases service

Extract the `currentPhaseId` logic from `services/phases.ts` into a pure module and add `computeCurrentTaskId`. This is a pure-function refactor — existing `phases.test.ts` must stay green.

**Files:**
- Create: `functions/src/derive.ts`
- Modify: `functions/src/services/phases.ts:46-55`
- Test: `functions/test/derive.test.ts`

- [ ] **Step 1: Write the failing test** (`functions/test/derive.test.ts`)

```typescript
import { describe, it, expect } from "vitest";
import { computeCurrentPhaseId, computeCurrentTaskId } from "../src/derive.js";

describe("computeCurrentPhaseId", () => {
  it("picks the lowest-order non-terminal phase; tiebreak by id", () => {
    expect(computeCurrentPhaseId([
      { id: "b", order: 2, status: "running" },
      { id: "a", order: 1, status: "running" },
    ])).toBe("a");
    expect(computeCurrentPhaseId([
      { id: "y", order: 1, status: "running" },
      { id: "x", order: 1, status: "running" },
    ])).toBe("x");
  });
  it("ignores terminal phases; null when all terminal", () => {
    expect(computeCurrentPhaseId([
      { id: "a", order: 1, status: "completed" },
      { id: "b", order: 2, status: "running" },
    ])).toBe("b");
    expect(computeCurrentPhaseId([{ id: "a", order: 1, status: "failed" }])).toBeNull();
  });
});

describe("computeCurrentTaskId", () => {
  const tasks = [
    { id: "t2", phaseId: "p1", order: 2, status: "queued" as const },
    { id: "t1", phaseId: "p1", order: 1, status: "running" as const },
    { id: "t3", phaseId: "p2", order: 1, status: "running" as const },
  ];
  it("picks the lowest-order non-terminal task within the current phase", () => {
    expect(computeCurrentTaskId("p1", tasks)).toBe("t1");
    expect(computeCurrentTaskId("p2", tasks)).toBe("t3");
  });
  it("is null when there is no current phase or no non-terminal task there", () => {
    expect(computeCurrentTaskId(null, tasks)).toBeNull();
    expect(computeCurrentTaskId("p1", [{ id: "t1", phaseId: "p1", order: 1, status: "completed" }])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npm run test:run -- derive`
Expected: FAIL — cannot find module `../src/derive.js`.

- [ ] **Step 3: Write the implementation** (`functions/src/derive.ts`)

```typescript
import { isTerminal, type Status } from "./status.js";

export interface PhaseLite { id: string; order: number; status: Status; }
export interface TaskLite { id: string; phaseId: string; order: number; status: Status; }

function byOrderThenId(a: { order: number; id: string }, b: { order: number; id: string }): number {
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Lowest-order non-terminal phase; tiebreak by id. Null if all phases are terminal. */
export function computeCurrentPhaseId(phases: PhaseLite[]): string | null {
  const open = phases.filter((p) => !isTerminal(p.status)).sort(byOrderThenId);
  return open.length > 0 ? open[0].id : null;
}

/** Lowest-order non-terminal task in the current phase; tiebreak by id. Null if no current phase. */
export function computeCurrentTaskId(currentPhaseId: string | null, tasks: TaskLite[]): string | null {
  if (!currentPhaseId) return null;
  const open = tasks.filter((t) => t.phaseId === currentPhaseId && !isTerminal(t.status)).sort(byOrderThenId);
  return open.length > 0 ? open[0].id : null;
}
```

- [ ] **Step 4: Refactor `services/phases.ts` to use `computeCurrentPhaseId`**

Replace the inline derivation block (`functions/src/services/phases.ts:46-55`) so it imports and calls the helper. Add the import at the top:

```typescript
import { computeCurrentPhaseId } from "../derive.js";
```

Replace lines 46-55 (the `// --- recompute currentPhaseId …` block through the `const currentPhaseId = …` line) with:

```typescript
    // --- recompute currentPhaseId from the full phase set with this write applied ---
    const phases = phasesSnap.docs
      .filter((d) => d.id !== phaseId)
      .map((d) => ({ id: d.id, order: d.data().order as number, status: d.data().status as Status }));
    phases.push({ id: phaseId, order: newOrder, status: newStatus });
    const currentPhaseId = computeCurrentPhaseId(phases);
```

- [ ] **Step 5: Run derive + phases tests to verify all pass**

Run: `cd functions && npm test -- derive phases`
Expected: PASS — `derive.test.ts` (4 tests) and the unchanged `phases.test.ts` (all green; behavior identical).

- [ ] **Step 6: Commit**

```bash
git add functions/src/derive.ts functions/test/derive.test.ts functions/src/services/phases.ts
git commit -m "refactor(api): extract current-phase/task derivation into derive.ts"
```

---

## Task 3: zod body schemas for the new entities + events

**Files:**
- Modify: `functions/src/schemas.ts`
- Test: `functions/test/schemas.test.ts`

- [ ] **Step 1: Write the failing test** (append to `functions/test/schemas.test.ts`)

```typescript
import { goalBody, scenarioBody, taskBody, documentBody, scoreBody, testRunBody, revisionBody } from "../src/schemas.js";

describe("loop-contract schemas", () => {
  it("scenario rubric requires criteria with positive weight and max>=1", () => {
    expect(scenarioBody.safeParse({ goalId: "g1", title: "S", rubric: { criteria: [{ id: "c1", name: "Correctness", weight: 2, max: 5 }] } }).success).toBe(true);
    expect(scenarioBody.safeParse({ rubric: { criteria: [{ id: "c1", name: "x", weight: 0, max: 5 }] } }).success).toBe(false);
    expect(scenarioBody.safeParse({ threshold: 150 }).success).toBe(false);
  });
  it("task scenarioIds must be valid ids", () => {
    expect(taskBody.safeParse({ phaseId: "p1", title: "T", order: 1, status: "running", scenarioIds: ["s1", "s2"] }).success).toBe(true);
    expect(taskBody.safeParse({ scenarioIds: ["Bad Id"] }).success).toBe(false);
  });
  it("score criteria are non-negative integers; composite is 0..100", () => {
    expect(scoreBody.safeParse({ scenarioId: "s1", taskId: "t1", criteria: { c1: 3 }, composite: 80 }).success).toBe(true);
    expect(scoreBody.safeParse({ scenarioId: "s1", taskId: "t1", criteria: { c1: -1 }, composite: 80 }).success).toBe(false);
    expect(scoreBody.safeParse({ scenarioId: "s1", taskId: "t1", criteria: { c1: 3 }, composite: 101 }).success).toBe(false);
  });
  it("document content is capped at 100KB and format is markdown|url", () => {
    expect(documentBody.safeParse({ kind: "vision", title: "V", format: "markdown", content: "x" }).success).toBe(true);
    expect(documentBody.safeParse({ format: "pdf" }).success).toBe(false);
    expect(documentBody.safeParse({ content: "x".repeat(100 * 1024 + 1) }).success).toBe(false);
  });
  it("goal/testRun/revision basic shapes", () => {
    expect(goalBody.safeParse({ title: "G", order: 1 }).success).toBe(true);
    expect(testRunBody.safeParse({ scenarioId: "s1", taskId: "t1", passed: 8, failed: 1, issues: ["flaky"] }).success).toBe(true);
    expect(testRunBody.safeParse({ scenarioId: "s1", taskId: "t1", passed: -1, failed: 0 }).success).toBe(false);
    expect(revisionBody.safeParse({ trigger: { scenarioId: "s1", reason: "short" }, changes: [{ op: "drop", taskId: "t9" }] }).success).toBe(true);
    expect(revisionBody.safeParse({ trigger: { scenarioId: "s1", reason: "x" }, changes: [{ op: "bogus", taskId: "t9" }] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npm run test:run -- schemas`
Expected: FAIL — the new schema exports do not exist.

- [ ] **Step 3: Add the schemas** (append to `functions/src/schemas.ts`, before the `keyMintBody` block)

```typescript
const id = z.string().regex(idPattern);

export const goalBody = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  order: z.number().int().optional(),
});

const rubricCriterion = z.object({
  id,
  name: z.string().min(1),
  weight: z.number().positive(),
  max: z.number().int().min(1),
});
const rubric = z.object({ criteria: z.array(rubricCriterion).min(1) });

export const scenarioBody = z.object({
  goalId: id.optional(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  order: z.number().int().optional(),
  threshold: z.number().min(0).max(100).optional(),
  rubric: rubric.optional(),
});

export const taskBody = z.object({
  phaseId: id.optional(),
  title: z.string().min(1).optional(),
  order: z.number().int().optional(),
  status: status.optional(),
  scenarioIds: z.array(id).optional(),
});

export const documentBody = z.object({
  kind: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  format: z.enum(["markdown", "url"]).optional(),
  content: z.string().max(100 * 1024, "document.content exceeds 100KB").optional(),
});

// Events: append-only POST. All fields required (an event is never a partial patch);
// zod enforces structure, the service layer enforces cross-document rules (criterion <= max).
export const scoreBody = z.object({
  scenarioId: id,
  taskId: id,
  commitSha: id.optional(),
  criteria: z.record(z.string(), z.number().int().min(0)),
  composite: z.number().min(0).max(100),
  by: z.string().min(1).optional(),
  note: z.string().optional(),
});

export const testRunBody = z.object({
  scenarioId: id,
  taskId: id,
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  issues: z.array(z.string()).optional(),
});

export const revisionBody = z.object({
  trigger: z.object({ scenarioId: id, reason: z.string().min(1) }),
  // changes carry op + taskId plus optional op-specific detail (title/order/...). passthrough
  // keeps that detail; the loop, not Daloop, defines its meaning.
  changes: z.array(z.object({ op: z.enum(["add", "replace", "reorder", "drop"]), taskId: id }).passthrough()).min(1),
});

export type GoalBody = z.infer<typeof goalBody>;
export type ScenarioBody = z.infer<typeof scenarioBody>;
export type TaskBody = z.infer<typeof taskBody>;
export type DocumentBody = z.infer<typeof documentBody>;
export type ScoreBody = z.infer<typeof scoreBody>;
export type TestRunBody = z.infer<typeof testRunBody>;
export type RevisionBody = z.infer<typeof revisionBody>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npm run test:run -- schemas`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/schemas.ts functions/test/schemas.test.ts
git commit -m "feat(api): zod schemas for goals, scenarios, tasks, documents, and events"
```

---

## Task 4: Goal entity — service + route + mount

**Files:**
- Create: `functions/src/services/goals.ts`, `functions/src/routes/goals.ts`
- Modify: `functions/src/app.ts`
- Test: `functions/test/goals.test.ts`

- [ ] **Step 1: Write the failing test** (`functions/test/goals.test.ts`)

```typescript
import { describe, it, expect } from "vitest";
import request from "supertest";
import "./helpers.js";
import { authHeader, seedMember } from "./helpers.js";
import { makeApp } from "../src/app.js";
import { db } from "../src/firestore.js";

const app = makeApp();
async function seedTeam(teamId = "team1") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
  await seedMember(teamId);
}
async function createProject(slug = "acme") {
  await seedTeam();
  await request(app).put(`/v1/teams/team1/projects/${slug}`).set(authHeader()).send({ title: "Acme", status: "running" });
}

describe("PUT /v1/teams/:teamId/projects/:slug/goals/:goalId", () => {
  it("404s when the project does not exist", async () => {
    await seedTeam();
    const res = await request(app).put("/v1/teams/team1/projects/ghost/goals/g1").set(authHeader()).send({ title: "Ship" });
    expect(res.status).toBe(404);
  });
  it("requires title on create", async () => {
    await createProject();
    const res = await request(app).put("/v1/teams/team1/projects/acme/goals/g1").set(authHeader()).send({ order: 1 });
    expect(res.status).toBe(400);
  });
  it("creates then patches a goal", async () => {
    await createProject();
    expect((await request(app).put("/v1/teams/team1/projects/acme/goals/g1").set(authHeader()).send({ title: "Ship", order: 1 })).status).toBe(200);
    let g = (await db().doc("teams/team1/projects/acme/goals/g1").get()).data()!;
    expect(g.title).toBe("Ship");
    expect(g.createdAt).toBeDefined();
    expect((await request(app).put("/v1/teams/team1/projects/acme/goals/g1").set(authHeader()).send({ description: "x" })).status).toBe(200);
    g = (await db().doc("teams/team1/projects/acme/goals/g1").get()).data()!;
    expect(g.title).toBe("Ship"); // unchanged on patch
    expect(g.description).toBe("x");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npm run test:run -- goals`
Expected: FAIL — route not mounted (404 on a valid create, or module-not-found).

- [ ] **Step 3: Write the service** (`functions/src/services/goals.ts`)

```typescript
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import type { GoalBody } from "../schemas.js";

export async function upsertGoal(teamId: string, slug: string, goalId: string, body: GoalBody): Promise<void> {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const goalRef = projectRef.collection("goals").doc(goalId);
  await db().runTransaction(async (tx) => {
    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists) throw new AppError(404, "not_found", "project does not exist");
    const snap = await tx.get(goalRef);
    if (!snap.exists && body.title === undefined) {
      throw new AppError(400, "validation", "title is required when creating a goal");
    }
    const data: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (!snap.exists) data.createdAt = FieldValue.serverTimestamp();
    if (body.title !== undefined) data.title = body.title;
    if (body.description !== undefined) data.description = body.description;
    if (body.order !== undefined) data.order = body.order;
    tx.set(goalRef, data, { merge: true });
  });
}
```

- [ ] **Step 4: Write the route** (`functions/src/routes/goals.ts`)

```typescript
import { Router } from "express";
import { idPattern, goalBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { upsertGoal } from "../services/goals.js";

export const goalsRouter = Router({ mergeParams: true });

goalsRouter.put("/:goalId", async (req, res, next) => {
  try {
    const { teamId, slug, goalId } = req.params as { teamId: string; slug: string; goalId: string };
    for (const [name, val] of [["teamId", teamId], ["slug", slug], ["goalId", goalId]] as const) {
      if (!idPattern.test(val)) throw new AppError(400, "validation", `invalid ${name}`);
    }
    const parsed = goalBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    await upsertGoal(teamId, slug, goalId, parsed.data);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 5: Mount the router** (`functions/src/app.ts`)

Add the import alongside the others, then mount it inside `teamRouter` **after `phases` and before `projectsRouter`**:

```typescript
import { goalsRouter } from "./routes/goals.js";
// …
  teamRouter.use("/:slug/goals", goalsRouter);
```

(Place it after the existing `teamRouter.use("/:slug/phases", phasesRouter);` line.)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd functions && npm run test:run -- goals`
Expected: PASS (3 tests). (Requires a running emulator, or use `npm test -- goals` which boots one.)

- [ ] **Step 7: Commit**

```bash
git add functions/src/services/goals.ts functions/src/routes/goals.ts functions/src/app.ts functions/test/goals.test.ts
git commit -m "feat(api): PUT goals entity"
```

---

## Task 5: Scenario entity — service + route + mount

Mirror Task 4. Required-on-create: `goalId` + `title` + `rubric`.

**Files:**
- Create: `functions/src/services/scenarios.ts`, `functions/src/routes/scenarios.ts`
- Modify: `functions/src/app.ts`
- Test: `functions/test/scenarios.test.ts`

- [ ] **Step 1: Write the failing test** (`functions/test/scenarios.test.ts`)

Copy the `seedTeam`/`createProject` header from Task 4's test, then:

```typescript
const rubric = { criteria: [{ id: "correctness", name: "Correctness", weight: 3, max: 5 }] };

describe("PUT /v1/teams/:teamId/projects/:slug/scenarios/:scenarioId", () => {
  it("requires goalId + title + rubric on create", async () => {
    await createProject();
    expect((await request(app).put("/v1/teams/team1/projects/acme/scenarios/s1").set(authHeader()).send({ title: "S" })).status).toBe(400);
  });
  it("creates a scenario with a rubric, then patches the threshold", async () => {
    await createProject();
    expect((await request(app).put("/v1/teams/team1/projects/acme/scenarios/s1").set(authHeader())
      .send({ goalId: "g1", title: "Login works", rubric, order: 1 })).status).toBe(200);
    let s = (await db().doc("teams/team1/projects/acme/scenarios/s1").get()).data()!;
    expect(s.rubric.criteria[0].id).toBe("correctness");
    expect((await request(app).put("/v1/teams/team1/projects/acme/scenarios/s1").set(authHeader()).send({ threshold: 90 })).status).toBe(200);
    s = (await db().doc("teams/team1/projects/acme/scenarios/s1").get()).data()!;
    expect(s.threshold).toBe(90);
    expect(s.title).toBe("Login works");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npm run test:run -- scenarios`
Expected: FAIL.

- [ ] **Step 3: Write the service** (`functions/src/services/scenarios.ts`)

```typescript
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import type { ScenarioBody } from "../schemas.js";

export async function upsertScenario(teamId: string, slug: string, scenarioId: string, body: ScenarioBody): Promise<void> {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const ref = projectRef.collection("scenarios").doc(scenarioId);
  await db().runTransaction(async (tx) => {
    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists) throw new AppError(404, "not_found", "project does not exist");
    const snap = await tx.get(ref);
    if (!snap.exists && (body.goalId === undefined || body.title === undefined || body.rubric === undefined)) {
      throw new AppError(400, "validation", "goalId, title and rubric are required when creating a scenario");
    }
    const data: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (!snap.exists) data.createdAt = FieldValue.serverTimestamp();
    if (body.goalId !== undefined) data.goalId = body.goalId;
    if (body.title !== undefined) data.title = body.title;
    if (body.description !== undefined) data.description = body.description;
    if (body.order !== undefined) data.order = body.order;
    if (body.threshold !== undefined) data.threshold = body.threshold;
    if (body.rubric !== undefined) data.rubric = body.rubric;
    tx.set(ref, data, { merge: true });
  });
}
```

- [ ] **Step 4: Write the route** (`functions/src/routes/scenarios.ts`)

Identical structure to `routes/goals.ts`, swapping `goalBody`→`scenarioBody`, `upsertGoal`→`upsertScenario`, param `goalId`→`scenarioId`, path `/:scenarioId`.

- [ ] **Step 5: Mount** (`functions/src/app.ts`)

```typescript
import { scenariosRouter } from "./routes/scenarios.js";
// …
  teamRouter.use("/:slug/scenarios", scenariosRouter);
```

(After the `goals` mount.)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd functions && npm test -- scenarios`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add functions/src/services/scenarios.ts functions/src/routes/scenarios.ts functions/src/app.ts functions/test/scenarios.test.ts
git commit -m "feat(api): PUT scenarios entity with rubric"
```

---

## Task 6: Task entity — service (recomputes currentTaskId) + route + mount

**Files:**
- Create: `functions/src/services/tasks.ts`, `functions/src/routes/tasks.ts`
- Modify: `functions/src/app.ts`
- Test: `functions/test/tasks.test.ts`

- [ ] **Step 1: Write the failing test** (`functions/test/tasks.test.ts`)

Copy the `seedTeam`/`createProject` header, then:

```typescript
async function startPhase(phaseId: string, order: number, status = "running") {
  await request(app).put(`/v1/teams/team1/projects/acme/phases/${phaseId}`).set(authHeader()).send({ name: phaseId, order, status });
}

describe("PUT /v1/teams/:teamId/projects/:slug/tasks/:taskId", () => {
  it("requires phaseId+title+order+status on create", async () => {
    await createProject();
    expect((await request(app).put("/v1/teams/team1/projects/acme/tasks/t1").set(authHeader()).send({ title: "T" })).status).toBe(400);
  });
  it("sets currentTaskId to the lowest-order non-terminal task in the current phase", async () => {
    await createProject();
    await startPhase("p1", 1);
    await request(app).put("/v1/teams/team1/projects/acme/tasks/t2").set(authHeader()).send({ phaseId: "p1", title: "B", order: 2, status: "queued" });
    await request(app).put("/v1/teams/team1/projects/acme/tasks/t1").set(authHeader()).send({ phaseId: "p1", title: "A", order: 1, status: "running" });
    expect((await db().doc("teams/team1/projects/acme").get()).data()!.currentTaskId).toBe("t1");
  });
  it("advances currentTaskId when the current task completes", async () => {
    await createProject();
    await startPhase("p1", 1);
    await request(app).put("/v1/teams/team1/projects/acme/tasks/t1").set(authHeader()).send({ phaseId: "p1", title: "A", order: 1, status: "running" });
    await request(app).put("/v1/teams/team1/projects/acme/tasks/t2").set(authHeader()).send({ phaseId: "p1", title: "B", order: 2, status: "queued" });
    await request(app).put("/v1/teams/team1/projects/acme/tasks/t1").set(authHeader()).send({ status: "completed" });
    expect((await db().doc("teams/team1/projects/acme").get()).data()!.currentTaskId).toBe("t2");
  });
  it("stores scenarioIds", async () => {
    await createProject();
    await startPhase("p1", 1);
    await request(app).put("/v1/teams/team1/projects/acme/tasks/t1").set(authHeader()).send({ phaseId: "p1", title: "A", order: 1, status: "running", scenarioIds: ["s1", "s2"] });
    expect((await db().doc("teams/team1/projects/acme/tasks/t1").get()).data()!.scenarioIds).toEqual(["s1", "s2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npm run test:run -- tasks`
Expected: FAIL.

- [ ] **Step 3: Write the service** (`functions/src/services/tasks.ts`)

```typescript
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import { computeCurrentTaskId, type TaskLite } from "../derive.js";
import type { Status } from "../status.js";
import type { TaskBody } from "../schemas.js";

export async function upsertTask(teamId: string, slug: string, taskId: string, body: TaskBody): Promise<void> {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const taskRef = projectRef.collection("tasks").doc(taskId);
  await db().runTransaction(async (tx) => {
    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists) throw new AppError(404, "not_found", "project does not exist");
    const taskSnap = await tx.get(taskRef);
    const tasksSnap = await tx.get(projectRef.collection("tasks"));

    const creating = !taskSnap.exists;
    if (creating && (body.phaseId === undefined || body.title === undefined || body.order === undefined || body.status === undefined)) {
      throw new AppError(400, "validation", "phaseId, title, order and status are required when creating a task");
    }
    const existing = taskSnap.data() ?? {};
    const newPhaseId: string = (body.phaseId ?? existing.phaseId) as string;
    const newOrder: number = (body.order ?? existing.order) as number;
    const newStatus: Status = (body.status ?? existing.status) as Status;

    const data: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (creating) data.createdAt = FieldValue.serverTimestamp();
    if (body.phaseId !== undefined) data.phaseId = body.phaseId;
    if (body.title !== undefined) data.title = body.title;
    if (body.order !== undefined) data.order = body.order;
    if (body.status !== undefined) data.status = body.status;
    if (body.scenarioIds !== undefined) data.scenarioIds = body.scenarioIds;

    // --- recompute currentTaskId from the full task set with this write applied ---
    const currentPhaseId = (projectSnap.data()!.currentPhaseId ?? null) as string | null;
    const tasks: TaskLite[] = tasksSnap.docs
      .filter((d) => d.id !== taskId)
      .map((d) => ({ id: d.id, phaseId: d.data().phaseId as string, order: d.data().order as number, status: d.data().status as Status }));
    tasks.push({ id: taskId, phaseId: newPhaseId, order: newOrder, status: newStatus });
    const currentTaskId = computeCurrentTaskId(currentPhaseId, tasks);

    tx.set(taskRef, data, { merge: true });
    tx.set(projectRef, { currentTaskId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}
```

- [ ] **Step 4: Write the route** (`functions/src/routes/tasks.ts`)

Same structure as `routes/goals.ts`, using `taskBody` / `upsertTask`, param `taskId`, path `/:taskId`.

- [ ] **Step 5: Mount** (`functions/src/app.ts`)

```typescript
import { tasksRouter } from "./routes/tasks.js";
// …
  teamRouter.use("/:slug/tasks", tasksRouter);
```

(After the `scenarios` mount. The task-commits mount in Task 8 must come **before** this line.)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd functions && npm test -- tasks`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add functions/src/services/tasks.ts functions/src/routes/tasks.ts functions/src/app.ts functions/test/tasks.test.ts
git commit -m "feat(api): PUT tasks entity with derived currentTaskId"
```

---

## Task 7: Phase writes also recompute currentTaskId

A phase upsert can move `currentPhaseId`, which changes which task is current. Extend `upsertPhase` to read the tasks collection and recompute `currentTaskId` alongside `currentPhaseId`.

**Files:**
- Modify: `functions/src/services/phases.ts`
- Test: `functions/test/phases.test.ts` (add one case)

- [ ] **Step 1: Add the failing test** (append inside the existing `describe` in `functions/test/phases.test.ts`)

```typescript
  it("recomputes currentTaskId when the current phase changes", async () => {
    await createProject();
    await request(app).put("/v1/teams/team1/projects/acme/phases/p1").set(authHeader()).send({ name: "A", order: 1, status: "running" });
    await request(app).put("/v1/teams/team1/projects/acme/phases/p2").set(authHeader()).send({ name: "B", order: 2, status: "queued" });
    await request(app).put("/v1/teams/team1/projects/acme/tasks/t1").set(authHeader()).send({ phaseId: "p1", title: "A", order: 1, status: "running" });
    await request(app).put("/v1/teams/team1/projects/acme/tasks/t2").set(authHeader()).send({ phaseId: "p2", title: "B", order: 1, status: "queued" });
    expect((await db().doc("teams/team1/projects/acme").get()).data()!.currentTaskId).toBe("t1");
    // complete p1 -> current phase becomes p2 -> current task becomes t2
    await request(app).put("/v1/teams/team1/projects/acme/phases/p1").set(authHeader()).send({ status: "completed" });
    const project = (await db().doc("teams/team1/projects/acme").get()).data()!;
    expect(project.currentPhaseId).toBe("p2");
    expect(project.currentTaskId).toBe("t2");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npm run test:run -- phases`
Expected: FAIL — `currentTaskId` stays `t1` (phases service doesn't touch it yet).

- [ ] **Step 3: Update `upsertPhase`** (`functions/src/services/phases.ts`)

Add the import:

```typescript
import { computeCurrentPhaseId, computeCurrentTaskId, type TaskLite } from "../derive.js";
```

Add a tasks read alongside the existing reads (after the `phasesSnap` read):

```typescript
    const tasksSnap = await tx.get(projectRef.collection("tasks"));
```

After computing `currentPhaseId`, recompute `currentTaskId` and include it in the project write:

```typescript
    const tasks: TaskLite[] = tasksSnap.docs
      .map((d) => ({ id: d.id, phaseId: d.data().phaseId as string, order: d.data().order as number, status: d.data().status as Status }));
    const currentTaskId = computeCurrentTaskId(currentPhaseId, tasks);
    // … existing tx.set(phaseRef, …) …
    tx.set(projectRef, { currentPhaseId, currentTaskId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
```

(Replace the existing `tx.set(projectRef, { currentPhaseId, updatedAt: … })` line with the one that also writes `currentTaskId`.)

- [ ] **Step 4: Run phases + tasks tests to verify all pass**

Run: `cd functions && npm test -- phases tasks`
Expected: PASS — new case green; all prior phase/task cases still green.

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/phases.ts functions/test/phases.test.ts
git commit -m "feat(api): phase writes recompute currentTaskId when the current phase moves"
```

---

## Task 8: Task-scoped commits (forward path) + update legacy CLI commit test later

The legacy phase-scoped commit route (`/:slug/phases/:phaseId/commits`, `services/commits.ts`, `commits.test.ts`) stays **unchanged**. This task adds the new task-scoped route.

**Files:**
- Create: `functions/src/services/taskCommits.ts`, `functions/src/routes/taskCommits.ts`
- Modify: `functions/src/app.ts`
- Test: `functions/test/taskCommits.test.ts`

- [ ] **Step 1: Write the failing test** (`functions/test/taskCommits.test.ts`)

Copy the `seedTeam`/`createProject` header, then:

```typescript
async function setup() {
  await createProject();
  await request(app).put("/v1/teams/team1/projects/acme/phases/p1").set(authHeader()).send({ name: "P", order: 1, status: "running" });
  await request(app).put("/v1/teams/team1/projects/acme/tasks/t1").set(authHeader()).send({ phaseId: "p1", title: "T", order: 1, status: "running" });
}

describe("PUT /v1/teams/:teamId/projects/:slug/tasks/:taskId/commits/:sha", () => {
  it("404s when the task does not exist", async () => {
    await createProject();
    const res = await request(app).put("/v1/teams/team1/projects/acme/tasks/ghost/commits/abc").set(authHeader()).send({ message: "m", author: "a" });
    expect(res.status).toBe(404);
  });
  it("requires message and author", async () => {
    await setup();
    expect((await request(app).put("/v1/teams/team1/projects/acme/tasks/t1/commits/abc").set(authHeader()).send({ message: "m" })).status).toBe(400);
  });
  it("writes a commit under the task", async () => {
    await setup();
    expect((await request(app).put("/v1/teams/team1/projects/acme/tasks/t1/commits/abc").set(authHeader())
      .send({ message: "feat: x", author: "Agent", committedAt: "2026-06-02T10:00:00Z" })).status).toBe(200);
    const c = (await db().doc("teams/team1/projects/acme/tasks/t1/commits/abc").get()).data()!;
    expect(c.message).toBe("feat: x");
    expect(c.author).toBe("Agent");
    expect(c.committedAt).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npm run test:run -- taskCommits`
Expected: FAIL.

- [ ] **Step 3: Write the service** (`functions/src/services/taskCommits.ts`)

Adapt `services/commits.ts`, swapping the phase ref for a task ref:

```typescript
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import type { CommitBody } from "../schemas.js";

export async function upsertTaskCommit(
  teamId: string, slug: string, taskId: string, sha: string, body: CommitBody,
): Promise<void> {
  const taskRef = db().doc(`teams/${teamId}/projects/${slug}/tasks/${taskId}`);
  const commitRef = taskRef.collection("commits").doc(sha);
  await db().runTransaction(async (tx) => {
    const taskSnap = await tx.get(taskRef);
    if (!taskSnap.exists) throw new AppError(404, "not_found", "project or task does not exist");
    const commitSnap = await tx.get(commitRef);
    if (body.message === undefined || body.author === undefined) {
      throw new AppError(400, "validation", "message and author are required");
    }
    const data: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (!commitSnap.exists) data.createdAt = FieldValue.serverTimestamp();
    data.message = body.message;
    data.author = body.author;
    if (body.url !== undefined) data.url = body.url;
    if (body.committedAt !== undefined && body.committedAt !== null) {
      data.committedAt = Timestamp.fromDate(new Date(body.committedAt));
    }
    tx.set(commitRef, data, { merge: true });
    tx.set(taskRef, { updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}
```

- [ ] **Step 4: Write the route** (`functions/src/routes/taskCommits.ts`)

Adapt `routes/commits.ts`: read params `{ teamId, slug, taskId, sha }`, validate all four with `idPattern`, parse `commitBody`, call `upsertTaskCommit`.

- [ ] **Step 5: Mount — BEFORE the `tasks` mount** (`functions/src/app.ts`)

```typescript
import { taskCommitsRouter } from "./routes/taskCommits.js";
// …
  teamRouter.use("/:slug/tasks/:taskId/commits", taskCommitsRouter);
  teamRouter.use("/:slug/tasks", tasksRouter); // (already added in Task 6 — ensure commits line is ABOVE it)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd functions && npm test -- taskCommits commits`
Expected: PASS — new task-commit tests green; legacy `commits.test.ts` still green.

- [ ] **Step 7: Commit**

```bash
git add functions/src/services/taskCommits.ts functions/src/routes/taskCommits.ts functions/src/app.ts functions/test/taskCommits.test.ts
git commit -m "feat(api): PUT task-scoped commits (legacy phase route retained)"
```

---

## Task 9: Document entity — service + route + mount

**Files:**
- Create: `functions/src/services/documents.ts`, `functions/src/routes/documents.ts`
- Modify: `functions/src/app.ts`
- Test: `functions/test/documents.test.ts`

- [ ] **Step 1: Write the failing test** (`functions/test/documents.test.ts`)

Copy the header, then:

```typescript
describe("PUT /v1/teams/:teamId/projects/:slug/documents/:docId", () => {
  it("requires kind+title+format+content on create", async () => {
    await createProject();
    expect((await request(app).put("/v1/teams/team1/projects/acme/documents/d1").set(authHeader()).send({ kind: "vision" })).status).toBe(400);
  });
  it("creates a markdown document", async () => {
    await createProject();
    expect((await request(app).put("/v1/teams/team1/projects/acme/documents/d1").set(authHeader())
      .send({ kind: "vision", title: "Vision", format: "markdown", content: "# Vision" })).status).toBe(200);
    const d = (await db().doc("teams/team1/projects/acme/documents/d1").get()).data()!;
    expect(d.kind).toBe("vision");
    expect(d.content).toBe("# Vision");
  });
  it("rejects content over 100KB with a 400", async () => {
    await createProject();
    const res = await request(app).put("/v1/teams/team1/projects/acme/documents/d1").set(authHeader())
      .send({ kind: "vision", title: "V", format: "markdown", content: "x".repeat(100 * 1024 + 1) });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npm run test:run -- documents`
Expected: FAIL.

- [ ] **Step 3: Write the service** (`functions/src/services/documents.ts`)

Mirror `services/goals.ts`. Collection `documents`. Required-on-create: `kind`, `title`, `format`, `content`. Copy each field through with `if (body.X !== undefined) data.X = body.X`.

- [ ] **Step 4: Write the route** (`functions/src/routes/documents.ts`)

Mirror `routes/goals.ts` with `documentBody` / `upsertDocument`, param `docId`, path `/:docId`.

- [ ] **Step 5: Mount** (`functions/src/app.ts`)

```typescript
import { documentsRouter } from "./routes/documents.js";
// …
  teamRouter.use("/:slug/documents", documentsRouter);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd functions && npm test -- documents`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add functions/src/services/documents.ts functions/src/routes/documents.ts functions/src/app.ts functions/test/documents.test.ts
git commit -m "feat(api): PUT documents entity"
```

---

## Task 10: Score event (append) — service with rubric validation + route + mount

**Files:**
- Create: `functions/src/services/events.ts`, `functions/src/routes/events.ts`
- Modify: `functions/src/app.ts`
- Test: `functions/test/events.test.ts`

- [ ] **Step 1: Write the failing test** (`functions/test/events.test.ts`)

Copy the header, then a `seedScenario` helper and the score cases:

```typescript
const rubric = { criteria: [{ id: "correctness", name: "C", weight: 3, max: 5 }, { id: "ux", name: "UX", weight: 1, max: 5 }] };
async function seedScenario() {
  await createProject();
  await request(app).put("/v1/teams/team1/projects/acme/scenarios/s1").set(authHeader()).send({ goalId: "g1", title: "S", rubric });
}

describe("POST /v1/teams/:teamId/projects/:slug/scores", () => {
  it("404s when the scenario does not exist", async () => {
    await createProject();
    const res = await request(app).post("/v1/teams/team1/projects/acme/scores").set(authHeader())
      .send({ scenarioId: "ghost", taskId: "t1", criteria: { correctness: 3 }, composite: 60 });
    expect(res.status).toBe(404);
  });
  it("rejects a criterion key not in the rubric", async () => {
    await seedScenario();
    const res = await request(app).post("/v1/teams/team1/projects/acme/scores").set(authHeader())
      .send({ scenarioId: "s1", taskId: "t1", criteria: { bogus: 3 }, composite: 60 });
    expect(res.status).toBe(400);
  });
  it("rejects a criterion value over its max", async () => {
    await seedScenario();
    const res = await request(app).post("/v1/teams/team1/projects/acme/scores").set(authHeader())
      .send({ scenarioId: "s1", taskId: "t1", criteria: { correctness: 9 }, composite: 60 });
    expect(res.status).toBe(400);
  });
  it("appends a score with a server-stamped sortable id and returns it", async () => {
    await seedScenario();
    const res = await request(app).post("/v1/teams/team1/projects/acme/scores").set(authHeader())
      .send({ scenarioId: "s1", taskId: "t1", criteria: { correctness: 4, ux: 3 }, composite: 82, note: "ok" });
    expect(res.status).toBe(200);
    expect(res.body.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    const d = (await db().doc(`teams/team1/projects/acme/scores/${res.body.id}`).get()).data()!;
    expect(d.composite).toBe(82);
    expect(d.by).toBe("ai"); // default
    expect(d.createdAt).toBeDefined();
  });
  it("orders appended scores by id (replay order)", async () => {
    await seedScenario();
    const ids: string[] = [];
    for (const c of [60, 70, 90]) {
      const r = await request(app).post("/v1/teams/team1/projects/acme/scores").set(authHeader())
        .send({ scenarioId: "s1", taskId: "t1", criteria: { correctness: 3 }, composite: c });
      ids.push(r.body.id);
    }
    const snap = await db().collection("teams/team1/projects/acme/scores").orderBy("__name__").get();
    expect(snap.docs.map((d) => d.id)).toEqual(ids); // append order == id order
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npm run test:run -- events`
Expected: FAIL.

- [ ] **Step 3: Write the events service (score only for now)** (`functions/src/services/events.ts`)

```typescript
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import { ulid } from "../ulid.js";
import type { ScoreBody } from "../schemas.js";

/** Append a score event. Server stamps the id (sortable ULID) + createdAt. Returns the id. */
export async function appendScore(teamId: string, slug: string, body: ScoreBody): Promise<string> {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const scenarioRef = projectRef.collection("scenarios").doc(body.scenarioId);
  const scenarioSnap = await scenarioRef.get();
  if (!scenarioSnap.exists) throw new AppError(404, "not_found", "scenario does not exist");

  // Service-layer validation: criterion keys must match the rubric ids, values <= max.
  const criteria = (scenarioSnap.data()!.rubric?.criteria ?? []) as Array<{ id: string; max: number }>;
  const maxById = new Map(criteria.map((c) => [c.id, c.max]));
  for (const [key, val] of Object.entries(body.criteria)) {
    if (!maxById.has(key)) throw new AppError(400, "validation", `unknown criterion '${key}'`);
    if (val > (maxById.get(key) as number)) throw new AppError(400, "validation", `criterion '${key}' exceeds max ${maxById.get(key)}`);
  }

  const id = ulid();
  const data: Record<string, unknown> = {
    scenarioId: body.scenarioId,
    taskId: body.taskId,
    criteria: body.criteria,
    composite: body.composite,
    by: body.by ?? "ai",
    createdAt: FieldValue.serverTimestamp(),
  };
  if (body.commitSha !== undefined) data.commitSha = body.commitSha;
  if (body.note !== undefined) data.note = body.note;
  await projectRef.collection("scores").doc(id).set(data);
  return id;
}
```

- [ ] **Step 4: Write the events route (score only for now)** (`functions/src/routes/events.ts`)

```typescript
import { Router } from "express";
import { idPattern, scoreBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { appendScore } from "../services/events.js";

export const scoresRouter = Router({ mergeParams: true });

scoresRouter.post("/", async (req, res, next) => {
  try {
    const { teamId, slug } = req.params as { teamId: string; slug: string };
    if (!idPattern.test(teamId)) throw new AppError(400, "validation", "invalid teamId");
    if (!idPattern.test(slug)) throw new AppError(400, "validation", "invalid project slug");
    const parsed = scoreBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const id = await appendScore(teamId, slug, parsed.data);
    res.status(200).json({ ok: true, id });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 5: Mount** (`functions/src/app.ts`)

```typescript
import { scoresRouter } from "./routes/events.js";
// …
  teamRouter.use("/:slug/scores", scoresRouter);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd functions && npm test -- events`
Expected: PASS (5 score tests).

- [ ] **Step 7: Commit**

```bash
git add functions/src/services/events.ts functions/src/routes/events.ts functions/src/app.ts functions/test/events.test.ts
git commit -m "feat(api): POST score events with rubric validation and sortable ids"
```

---

## Task 11: TestRun + Revision events — extend service + routes + mount

**Files:**
- Modify: `functions/src/services/events.ts`, `functions/src/routes/events.ts`, `functions/src/app.ts`
- Test: `functions/test/events.test.ts` (add describes)

- [ ] **Step 1: Add the failing tests** (append to `functions/test/events.test.ts`)

```typescript
describe("POST /v1/teams/:teamId/projects/:slug/testRuns", () => {
  it("404s when the project does not exist", async () => {
    await seedTeam();
    const res = await request(app).post("/v1/teams/team1/projects/ghost/testRuns").set(authHeader())
      .send({ scenarioId: "s1", taskId: "t1", passed: 1, failed: 0 });
    expect(res.status).toBe(404);
  });
  it("appends a testRun with issues", async () => {
    await createProject();
    const res = await request(app).post("/v1/teams/team1/projects/acme/testRuns").set(authHeader())
      .send({ scenarioId: "s1", taskId: "t1", passed: 8, failed: 1, issues: ["flaky login"] });
    expect(res.status).toBe(200);
    const d = (await db().doc(`teams/team1/projects/acme/testRuns/${res.body.id}`).get()).data()!;
    expect(d.passed).toBe(8);
    expect(d.failed).toBe(1);
    expect(d.issues).toEqual(["flaky login"]);
  });
});

describe("POST /v1/teams/:teamId/projects/:slug/revisions", () => {
  it("appends a revision capturing trigger + changes", async () => {
    await createProject();
    const res = await request(app).post("/v1/teams/team1/projects/acme/revisions").set(authHeader())
      .send({ trigger: { scenarioId: "s1", reason: "still failing" }, changes: [{ op: "add", taskId: "t9", title: "Harden" }, { op: "drop", taskId: "t3" }] });
    expect(res.status).toBe(200);
    const d = (await db().doc(`teams/team1/projects/acme/revisions/${res.body.id}`).get()).data()!;
    expect(d.trigger.reason).toBe("still failing");
    expect(d.changes).toHaveLength(2);
    expect(d.changes[0].title).toBe("Harden"); // passthrough detail preserved
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npm run test:run -- events`
Expected: FAIL (testRuns/revisions routes not mounted).

- [ ] **Step 3: Extend the events service** (`functions/src/services/events.ts`)

Add `appendTestRun` and `appendRevision`. Both check project existence and write a ULID-keyed doc. Add a small shared helper:

```typescript
import type { TestRunBody, RevisionBody } from "../schemas.js";

async function requireProject(teamId: string, slug: string) {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const snap = await projectRef.get();
  if (!snap.exists) throw new AppError(404, "not_found", "project does not exist");
  return projectRef;
}

export async function appendTestRun(teamId: string, slug: string, body: TestRunBody): Promise<string> {
  const projectRef = await requireProject(teamId, slug);
  const id = ulid();
  await projectRef.collection("testRuns").doc(id).set({
    scenarioId: body.scenarioId,
    taskId: body.taskId,
    passed: body.passed,
    failed: body.failed,
    issues: body.issues ?? [],
    createdAt: FieldValue.serverTimestamp(),
  });
  return id;
}

export async function appendRevision(teamId: string, slug: string, body: RevisionBody): Promise<string> {
  const projectRef = await requireProject(teamId, slug);
  const id = ulid();
  await projectRef.collection("revisions").doc(id).set({
    trigger: body.trigger,
    changes: body.changes,
    createdAt: FieldValue.serverTimestamp(),
  });
  return id;
}
```

(Optionally refactor `appendScore` to reuse `requireProject` for the project check — not required since it already validates via the scenario.)

- [ ] **Step 4: Add the two routers** (`functions/src/routes/events.ts`)

```typescript
import { testRunBody, revisionBody } from "../schemas.js";
import { appendTestRun, appendRevision } from "../services/events.js";

export const testRunsRouter = Router({ mergeParams: true });
testRunsRouter.post("/", async (req, res, next) => {
  try {
    const { teamId, slug } = req.params as { teamId: string; slug: string };
    if (!idPattern.test(teamId)) throw new AppError(400, "validation", "invalid teamId");
    if (!idPattern.test(slug)) throw new AppError(400, "validation", "invalid project slug");
    const parsed = testRunBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const id = await appendTestRun(teamId, slug, parsed.data);
    res.status(200).json({ ok: true, id });
  } catch (err) { next(err); }
});

export const revisionsRouter = Router({ mergeParams: true });
revisionsRouter.post("/", async (req, res, next) => {
  try {
    const { teamId, slug } = req.params as { teamId: string; slug: string };
    if (!idPattern.test(teamId)) throw new AppError(400, "validation", "invalid teamId");
    if (!idPattern.test(slug)) throw new AppError(400, "validation", "invalid project slug");
    const parsed = revisionBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const id = await appendRevision(teamId, slug, parsed.data);
    res.status(200).json({ ok: true, id });
  } catch (err) { next(err); }
});
```

- [ ] **Step 5: Mount both** (`functions/src/app.ts`)

```typescript
import { scoresRouter, testRunsRouter, revisionsRouter } from "./routes/events.js";
// …
  teamRouter.use("/:slug/testRuns", testRunsRouter);
  teamRouter.use("/:slug/revisions", revisionsRouter);
```

(Update the existing `scoresRouter` import line to the combined import.)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd functions && npm test -- events`
Expected: PASS (all score + testRun + revision tests).

- [ ] **Step 7: Commit**

```bash
git add functions/src/services/events.ts functions/src/routes/events.ts functions/src/app.ts functions/test/events.test.ts
git commit -m "feat(api): POST testRun and revision events"
```

---

## Task 12: Security-rules tests for the new subcollections (no rules change)

The recursive `match /projects/{slug}/{document=**}` already grants member-read and denies all client writes. Add tests asserting this for the new paths.

**Files:**
- Modify: `functions/test-rules/rules.test.ts`

- [ ] **Step 1: Add the failing tests** (extend the `describe("rules: projects + isolation")` block's `seedProjectTree` and add a new `describe`)

Extend `seedProjectTree` to also seed the new subcollections:

```typescript
      await fs.doc(`teams/${teamId}/projects/web/goals/g1`).set({ title: "Ship", order: 1 });
      await fs.doc(`teams/${teamId}/projects/web/scenarios/s1`).set({ goalId: "g1", title: "S", rubric: { criteria: [] } });
      await fs.doc(`teams/${teamId}/projects/web/tasks/t1`).set({ phaseId: "p1", title: "T", order: 1, status: "running" });
      await fs.doc(`teams/${teamId}/projects/web/tasks/t1/commits/c1`).set({ message: "m", author: "a" });
      await fs.doc(`teams/${teamId}/projects/web/scores/01ABC`).set({ scenarioId: "s1", taskId: "t1", composite: 80 });
      await fs.doc(`teams/${teamId}/projects/web/testRuns/01DEF`).set({ scenarioId: "s1", taskId: "t1", passed: 1, failed: 0 });
      await fs.doc(`teams/${teamId}/projects/web/revisions/01GHI`).set({ trigger: { scenarioId: "s1", reason: "x" }, changes: [] });
      await fs.doc(`teams/${teamId}/projects/web/documents/d1`).set({ kind: "vision", title: "V", format: "markdown", content: "x" });
```

Then add:

```typescript
describe("rules: loop-contract subcollections", () => {
  const paths = [
    "goals/g1", "scenarios/s1", "tasks/t1", "tasks/t1/commits/c1",
    "scores/01ABC", "testRuns/01DEF", "revisions/01GHI", "documents/d1",
  ];
  it("members can read every loop-contract doc", async () => {
    await seedTeam("t1", "alice"); await seedMember("t1", "alice", "member"); await seedProjectTree("t1");
    const db = authed("alice");
    for (const p of paths) await assertSucceeds(db.doc(`teams/t1/projects/web/${p}`).get());
  });
  it("non-members cannot read loop-contract docs", async () => {
    await seedTeam("t1", "alice"); await seedMember("t1", "alice", "member"); await seedProjectTree("t1");
    const db = authed("bob");
    for (const p of paths) await assertFails(db.doc(`teams/t1/projects/web/${p}`).get());
  });
  it("clients cannot write loop-contract docs, even an owner", async () => {
    await seedTeam("t1", "alice"); await seedMember("t1", "alice", "owner"); await seedProjectTree("t1");
    const db = authed("alice");
    for (const p of paths) await assertFails(db.doc(`teams/t1/projects/web/${p}`).set({ x: 1 }));
  });
});
```

- [ ] **Step 2: Run the rules suite to verify the new tests pass**

Run: `cd functions && npm run test:rules`
Expected: PASS — all existing rules tests plus the new `loop-contract subcollections` block green (no rules change needed).

- [ ] **Step 3: Commit**

```bash
git add functions/test-rules/rules.test.ts
git commit -m "test(rules): assert member-read and client-write-deny for loop-contract subcollections"
```

---

## Task 13: CLI entity verbs + task-aware commit

Extend `cli/daloop.mjs` with the entity verbs and make `commit` task-scoped (auto-creating an implicit `main` task). Update the two existing CLI commit tests to the new task-scoped behavior.

**Files:**
- Modify: `cli/daloop.mjs`
- Modify: `functions/test/cli.unit.test.ts`

- [ ] **Step 1: Add failing unit tests** (append to `functions/test/cli.unit.test.ts`)

```typescript
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
});
```

- [ ] **Step 2: Update the existing `describe("commit")` unit tests to the task-scoped path**

In `functions/test/cli.unit.test.ts`, the `commit` block's `initDir` adds `currentTaskId`/`tasks`, and the URL assertion changes. Replace the `describe("commit")` block body:

```typescript
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
      fetchImpl: async (url: string, init: any) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({}) } });
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: FAIL — repeated-flag array, new verbs, and task-scoped commit not implemented.

- [ ] **Step 4: Implement in `cli/daloop.mjs`**

(a) Make `parseArgs` accumulate repeated flags into arrays. Replace the flag-assignment branch:

```javascript
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      const val = (next === undefined || next.startsWith("--")) ? true : (i++, next);
      if (key in flags) flags[key] = [].concat(flags[key], val); // repeated -> array
      else flags[key] = val;
    } else {
```

(b) Add a `asArray` helper near `parseArgs`:

```javascript
export function asArray(v) { return v === undefined ? [] : Array.isArray(v) ? v : [v]; }
function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "doc"; }
```

(c) Update `init` to seed the new config fields:

```javascript
        saveConfig(cwd, { apiUrl, teamId, projectSlug, currentPhaseId: null, currentTaskId: null, phases: {}, tasks: {} });
```

(d) Add the new `case` branches inside the `switch` (before `default`). Each resolves the API base via `resolveApiUrl(cfg, env, flags.url)` and reports best-effort with the same strict/teamId deps as existing commands. Use a local helper to cut repetition:

```javascript
      case "goal set": {
        const id = positionals[2]; validateId("goalId", id);
        const cfg = loadConfig(cwd);
        const body = {};
        if (flags.title) body.title = flags.title;
        if (flags.description) body.description = flags.description;
        if (typeof flags.order === "string") body.order = Number(flags.order);
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/goals/${id}`;
        return report({ method: "PUT", url, body }, { env, fetchImpl, err, strict: !!flags.strict || env.DALOOP_STRICT === "1", teamId: cfg.teamId });
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
          try { body.rubric = JSON.parse(readFileSync(join(cwd, flags.rubric), "utf8")); }
          catch (e) { throw new UsageError(`could not read --rubric '${flags.rubric}': ${e.message}`); }
        }
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/scenarios/${id}`;
        return report({ method: "PUT", url, body }, { env, fetchImpl, err, strict: !!flags.strict || env.DALOOP_STRICT === "1", teamId: cfg.teamId });
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
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/tasks/${id}`;
        return report({ method: "PUT", url, body: { phaseId: flags.phase, title: flags.name, order, status: "running", scenarioIds } },
          { env, fetchImpl, err, strict: !!flags.strict || env.DALOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "task set": {
        const id = positionals[2]; validateId("taskId", id);
        if (!flags.status) throw new UsageError("task set requires --status <s>");
        validateStatus(flags.status);
        const cfg = loadConfig(cwd);
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/tasks/${id}`;
        return report({ method: "PUT", url, body: { status: flags.status } },
          { env, fetchImpl, err, strict: !!flags.strict || env.DALOOP_STRICT === "1", teamId: cfg.teamId });
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
          { env, fetchImpl, err, strict: !!flags.strict || env.DALOOP_STRICT === "1", teamId: cfg.teamId });
      }
```

(e) Replace the `case "commit"` body with the task-aware version:

```javascript
      case "commit": {
        const cfg = loadConfig(cwd);
        const apiBase = resolveApiUrl(cfg, env, flags.url);
        const strict = !!flags.strict || env.DALOOP_STRICT === "1";
        let taskId = (typeof flags.task === "string" && flags.task) || cfg.currentTaskId || null;
        if (taskId) validateId("taskId", taskId);
        if (!taskId) {
          if (!cfg.currentPhaseId) throw new UsageError("no current phase — run `daloop phase start` (or pass --task)");
          taskId = "main";
          const taskUrl = `${apiBase}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/tasks/${taskId}`;
          const tcode = await report({ method: "PUT", url: taskUrl, body: { phaseId: cfg.currentPhaseId, title: "Main", order: 0, status: "running", scenarioIds: [] } },
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
        const url = `${apiBase}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/tasks/${taskId}/commits/${c.sha}`;
        return report({ method: "PUT", url, body: { message: c.message, author: c.author, committedAt: c.committedAt } },
          { env, fetchImpl, err, strict, teamId: cfg.teamId });
      }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: PASS — new verbs, repeated-flag arrays, and task-scoped commit all green; updated commit tests pass.

- [ ] **Step 6: Commit**

```bash
git add cli/daloop.mjs functions/test/cli.unit.test.ts
git commit -m "feat(cli): goal/scenario/task/doc verbs and task-aware commit with implicit default task"
```

---

## Task 14: CLI event verbs + vision import + full e2e integration + sync copies

**Files:**
- Modify: `cli/daloop.mjs`
- Modify: `functions/test/cli.unit.test.ts`, `functions/test/cli.integration.test.ts`
- Sync: `web/public/skill/daloop.mjs`, `plugins/daloop-reporting/bin/daloop`

- [ ] **Step 1: Add failing unit tests for score/test-run/revise/vision import** (append to `functions/test/cli.unit.test.ts`)

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: FAIL — event/vision verbs not implemented.

- [ ] **Step 3: Fix the command dispatch for single-word verbs that take a positional**

`score` and `test-run` take a positional `<scenarioId>` (e.g. `daloop score s1 --task …`), but the dispatcher keys on `` `${cmd} ${sub ?? ""}`.trim() `` (`cli/daloop.mjs:119`) — so `score s1` becomes the key `"score s1"` and never matches `case "score":` (it falls through to `default` → "unknown command"). Before the `switch`, compute the key so single-word verbs match on `cmd` alone. Replace the line:

```javascript
    switch (`${cmd} ${sub ?? ""}`.trim()) {
```

with:

```javascript
    // Single-word verbs may take a positional arg (e.g. `score <scenarioId>`), so they
    // must NOT fold the positional into the dispatch key. Two-word verbs (e.g. `phase start`) do.
    const ONE_WORD = new Set(["init", "commit", "score", "test-run", "revise"]);
    const dispatchKey = ONE_WORD.has(cmd) ? cmd : `${cmd} ${sub ?? ""}`.trim();
    switch (dispatchKey) {
```

(This is behavior-preserving for the existing `init`/`commit` verbs — both already resolved to a single-word key since they carry no subcommand positional — and for every two-word verb.)

- [ ] **Step 4: Implement the verbs in `cli/daloop.mjs`** (new `case` branches before `default`)

```javascript
      case "score": {
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
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/scores`;
        return report({ method: "POST", url, body }, { env, fetchImpl, err, strict: !!flags.strict || env.DALOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "test-run": {
        const scenarioId = positionals[1]; validateId("scenarioId", scenarioId);
        if (!flags.task || typeof flags.passed !== "string" || typeof flags.failed !== "string") throw new UsageError("test-run requires --task <t> --passed <n> --failed <n>");
        validateId("task", flags.task);
        const body = { scenarioId, taskId: flags.task, passed: Number(flags.passed), failed: Number(flags.failed), issues: asArray(flags.issue).map(String) };
        const cfg = loadConfig(cwd);
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/testRuns`;
        return report({ method: "POST", url, body }, { env, fetchImpl, err, strict: !!flags.strict || env.DALOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "revise": {
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
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/revisions`;
        return report({ method: "POST", url, body }, { env, fetchImpl, err, strict: !!flags.strict || env.DALOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "vision import": {
        if (!flags.file) throw new UsageError("vision import requires --file <vision.json>");
        const cfg = loadConfig(cwd);
        let vision;
        try { vision = JSON.parse(readFileSync(join(cwd, flags.file), "utf8")); }
        catch (e) { throw new UsageError(`could not read --file '${flags.file}': ${e.message}`); }
        const apiBase = resolveApiUrl(cfg, env, flags.url);
        const strict = !!flags.strict || env.DALOOP_STRICT === "1";
        const deps = { env, fetchImpl, err, strict, teamId: cfg.teamId };
        const proj = `${apiBase}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}`;
        let worst = 0;
        for (const g of vision.goals ?? []) {
          validateId("goalId", g.id);
          const { id, ...body } = g;
          worst = Math.max(worst, await report({ method: "PUT", url: `${proj}/goals/${id}`, body }, deps));
        }
        for (const s of vision.scenarios ?? []) {
          validateId("scenarioId", s.id);
          const { id, ...body } = s;
          worst = Math.max(worst, await report({ method: "PUT", url: `${proj}/scenarios/${id}`, body }, deps));
        }
        for (const d of vision.documents ?? []) {
          validateId("docId", d.id);
          const { id, ...body } = d;
          worst = Math.max(worst, await report({ method: "PUT", url: `${proj}/documents/${id}`, body }, deps));
        }
        return worst; // best-effort: 0 unless strict and some report failed
      }
```

- [ ] **Step 5: Run unit tests to verify they pass**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: PASS (all CLI unit tests, including the new verbs).

- [ ] **Step 6: Update + extend the integration test** (`functions/test/cli.integration.test.ts`)

The existing first test asserts the legacy phase-commit path; update its commit assertion to the new task-scoped location, and add a full loop e2e. Replace the first test's commit assertion block:

```typescript
    expect(await run(["commit"], opts)).toBe(0);
    const project = (await db().doc("teams/itteam/projects/web").get()).data()!;
    expect(project.title).toBe("Web");
    expect(project.currentPhaseId).toBe("build");
    // commit now auto-creates the implicit 'main' task and lands under it
    const mainTask = (await db().doc("teams/itteam/projects/web/tasks/main").get()).data()!;
    expect(mainTask.phaseId).toBe("build");
    const commit = (await db().doc("teams/itteam/projects/web/tasks/main/commits/abc123").get()).data()!;
    expect(commit.message).toBe("feat: x");
    expect(commit.author).toBe("Agent");
```

Then add a new test covering the loop verbs end-to-end:

```typescript
  it("vision import -> task start -> commit -> score/test-run/revise -> doc add all land in Firestore", async () => {
    await seedKeyAndMember("loopteam");
    const cwd = dir();
    const opts = { cwd, env, log: () => {}, err: () => {}, gitRun: () => "c0ffee\n2026-06-02T10:00:00Z\nAgent\nfeat: y" };
    writeFileSync(join(cwd, "vision.json"), JSON.stringify({
      goals: [{ id: "g1", title: "Ship", order: 1 }],
      scenarios: [{ id: "s1", goalId: "g1", title: "Login", rubric: { criteria: [{ id: "correctness", name: "C", weight: 3, max: 5 }] } }],
    }));
    expect(await run(["init", "--team", "loopteam", "--project", "web", "--url", baseUrl], opts)).toBe(0);
    expect(await run(["project", "set", "--title", "Web", "--status", "running"], opts)).toBe(0);
    expect(await run(["phase", "start", "build", "--name", "Build", "--order", "1"], opts)).toBe(0);
    expect(await run(["vision", "import", "--file", "vision.json"], opts)).toBe(0);
    expect(await run(["task", "start", "t1", "--phase", "build", "--name", "Login", "--order", "1", "--scenarios", "s1"], opts)).toBe(0);
    expect(await run(["commit", "--task", "t1"], opts)).toBe(0);
    expect(await run(["score", "s1", "--task", "t1", "--criterion", "correctness=4", "--composite", "80"], opts)).toBe(0);
    expect(await run(["test-run", "s1", "--task", "t1", "--passed", "5", "--failed", "0"], opts)).toBe(0);
    expect(await run(["revise", "--scenario", "s1", "--reason", "tighten", "--change", "add:t2"], opts)).toBe(0);
    expect(await run(["doc", "add", "--kind", "notes", "--title", "Run Notes", "--url", "https://x.com/n"], opts)).toBe(0);

    expect((await db().doc("teams/loopteam/projects/web/scenarios/s1").get()).data()!.title).toBe("Login");
    expect((await db().doc("teams/loopteam/projects/web/tasks/t1/commits/c0ffee").get()).data()!.message).toBe("feat: y");
    expect((await db().collection("teams/loopteam/projects/web/scores").get()).size).toBe(1);
    expect((await db().collection("teams/loopteam/projects/web/testRuns").get()).size).toBe(1);
    expect((await db().collection("teams/loopteam/projects/web/revisions").get()).size).toBe(1);
    expect((await db().doc("teams/loopteam/projects/web/documents/run-notes").get()).data()!.format).toBe("url");
  });
```

**Imports:** `join` is already imported in the integration test header (`cli.integration.test.ts:4`) but `writeFileSync` is NOT — add it to the existing `node:fs` import (`import { mkdtempSync, writeFileSync } from "node:fs";`).

- [ ] **Step 7: Run the integration test to verify it passes**

Run: `cd functions && npm test -- cli.integration`
Expected: PASS — updated first test + new loop e2e green.

- [ ] **Step 8: Sync the CLI distribution copies**

Run: `bash scripts/sync-daloop-cli.sh`
Expected: `✓ synced cli/daloop.mjs → web/public/skill/daloop.mjs, plugins/daloop-reporting/bin/daloop`

- [ ] **Step 9: Commit**

```bash
git add cli/daloop.mjs functions/test/cli.unit.test.ts functions/test/cli.integration.test.ts web/public/skill/daloop.mjs plugins/daloop-reporting/bin/daloop
git commit -m "feat(cli): score/test-run/revise/vision-import verbs + loop e2e; sync CLI copies"
```

---

## Task 15: Full verification — build + all suites green

**Files:** none (verification only).

- [ ] **Step 1: Type-check the functions build**

Run: `cd functions && npm run build`
Expected: exits 0, no `tsc` errors. (Confirms every new `src/*.ts` compiles; `cli/` and `test/` are excluded by `include: ["src"]`.)

- [ ] **Step 2: Run the full main test suite (boots the emulator)**

Run: `cd functions && npm test`
Expected: PASS — all suites green, including `ulid`, `derive`, `schemas`, `goals`, `scenarios`, `tasks`, `phases`, `taskCommits`, `commits` (legacy, untouched), `documents`, `events`, `cli.unit`, `cli.integration`, and all pre-existing suites.

- [ ] **Step 3: Run the rules suite**

Run: `cd functions && npm run test:rules`
Expected: PASS — all rules tests including the new loop-contract subcollection block.

- [ ] **Step 4: Confirm the success criteria from the spec**

Verify by inspection of the green suites that: a loop can push a full vision (goals + scenarios + rubrics) + documents; a plan (phases + tasks); task-scoped commits; and score/test-run/revision events; members can read all of it; a reader can derive `scenario.state` (latest-by-id score + testRun) and replay events in id order; existing `project set`/`phase`/`commit` reporting still works (back-compat: legacy phase-commit route + implicit `main` task); reporting stays best-effort.

- [ ] **Step 5: Final commit (if any uncommitted verification fixes)**

```bash
git add -A
git commit -m "chore: loop-contract verification (build + API/rules/CLI suites green)"
```

---

## Notes for the executor

- **One module per responsibility.** Don't fold multiple entities into one service/route file — the website and future specs read these boundaries.
- **Never let the client set server-owned fields.** The plain `z.object` schemas drop unknown keys; the services only copy through the documented fields. Keep it that way.
- **Event ids are the replay order**, not `createdAt`. Always `orderBy("__name__")` (document id) when reading events back. `createdAt` is for display only.
- **Best-effort CLI.** Every new verb returns `report(...)`'s exit code (0 on reporting failure unless strict). Only pre-network usage problems throw `UsageError` (exit 1).
- **Back-compat is load-bearing.** Do not modify `services/commits.ts`, `routes/commits.ts`, the legacy mount in `app.ts`, or `commits.test.ts`. The legacy phase-scoped commit path must keep working for already-deployed clients and old data.
