# Loop Level (contract v2.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a `loop` level — `project → loop → phase → task → commit` — via a new `Loop` entity + loop-scoped routes, with existing project-direct data retained as an implicit `main` loop (no migration). Entity services become base-path-aware (operate project-direct OR under `loops/{loopId}/…`); the project gains `currentLoopId`; per-loop `currentPhaseId`/`currentTaskId` derive on the loop doc.

**Architecture:** Additive + back-compatible (mirrors #1's commit-relocation). Each existing upsert/append service gets an **optional `loopId`** → a `baseRef` (`loops/{loopId}` doc when set, else the project doc); run-data docs + per-loop derivation use `baseRef`, while **scenario reads and the `visionOwner` stamp stay on the project**. Each entity router is mounted at BOTH the legacy path and `…/loops/:loopId/…`; handlers pass `req.params.loopId` through. Firestore rules are unchanged (the recursive `match /projects/{slug}/{document=**}` already covers `loops/**`); tests only. The CLI gains `loop start/set` + routes reporting under `cfg.currentLoopId` when set.

**Tech Stack:** TypeScript Cloud Function (Express + firebase-admin + zod), Vitest + Firestore emulator. CLI is `cli/daloop.mjs`. No new deps.

**Reference spec:** `docs/superpowers/specs/2026-06-03-loop-level-contract-design.md`

---

## Background / conventions (read before Task 1) — THE INVARIANTS

The base-path refactor MUST preserve these or it regresses #1/#5 (the existing 180+ tests are the guard):
- **`baseRef` = `loopId ? projectRef.collection("loops").doc(loopId) : projectRef`.** Run-data collections (`phases`, `tasks`, `scores`, `testRuns`, `revisions`, and `tasks/{id}/commits`) and the per-loop derived fields (`currentPhaseId`/`currentTaskId`) live under / on `baseRef`.
- **Existence check:** the service checks `baseRef` exists (404). For legacy (`baseRef===projectRef`) the message stays "project does not exist"; for loop-scoped, "project or loop does not exist".
- **Scenario reads stay on the PROJECT** (`appendScore` reads `projectRef.collection("scenarios")` — scenarios are project-level vision; they never exist under a loop). A loop-scoped score writes under `baseRef` but validates against the project scenario.
- **`visionOwner` stamp stays on the PROJECT doc** (`upsertTask` must `tx.set(projectRef, { visionOwner: "loop" }, {merge}})` even when loop-scoped — it's vision-ownership for #5's `assertWebEditable`, not run state). The per-loop `currentTaskId` goes on `baseRef`.
- **Vision services unchanged:** `upsertProject`/`applyProjectUpsert`, goals/scenarios/documents (and the whole `/v1/u` path) are project-level — DO NOT add a loopId to them.
- **Reads before writes** in every transaction (as today). Keep `appendScore`'s non-transactional `.set()` (server id).
- Legacy behavior (loopId undefined → `baseRef===projectRef`) must be **byte-for-byte** today's behavior so #1's phases/tasks/commits/events tests pass unchanged.
- **Read-set discipline:** in legacy mode the already-read `projectSnap` IS `baseSnap` (don't add a second `tx.get` for the same ref); loop-scoped adds exactly one `tx.get(loopRef)` for `baseSnap`. (Keeps the transaction read-set identical to today in legacy mode.)
- **Phase-commits stays legacy-only by design.** Only **task-commits** become loop-scoped (the spec nests commits under tasks; the CLI `commit` uses the task-commits path). Do NOT add a loop-scoped mount for the legacy phase-commits route (`commitsRouter`/`upsertCommit`) — leave it untouched.
- **Commands:** `cd functions && npm test` (full, emulator) / `npm run test:run -- <name>` (running emulator) / `npm run build`. Do NOT `git add -A`.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `functions/src/derive.ts` | add `computeCurrentLoopId` (+ `LoopLite`) | 1 |
| `functions/src/schemas.ts` | add `loopBody` | 2 |
| `functions/src/services/loops.ts` | `upsertLoop` (+ project `currentLoopId`) | 2 |
| `functions/src/routes/loops.ts` | `PUT /:loopId` | 2 |
| `functions/src/services/{phases,tasks}.ts` | base-path-aware (loopId) + per-loop derivation | 3 |
| `functions/src/services/{taskCommits,events}.ts` | base-path-aware (loopId); scenario reads stay project | 4 |
| `functions/src/routes/{phases,tasks,taskCommits,events}.ts` | pass `req.params.loopId` to services | 5 |
| `functions/src/app.ts` | mount loops router + loop-scoped mounts of each entity router | 5 |
| `cli/daloop.mjs` | `loop start/set` + loop-aware URLs + init seeds | 6 |
| `functions/test-rules/rules.test.ts` | loops/** read/deny tests | 7 |
| `functions/test/*` | loop entity, loop-scoped, regression | 2–8 |

---

## Task 1: `computeCurrentLoopId` in derive.ts

**Files:** Modify `functions/src/derive.ts`; Test `functions/test/derive.test.ts`.

- [ ] **Step 1: Failing test** (append to `derive.test.ts`)

```typescript
import { computeCurrentLoopId } from "../src/derive.js";
describe("computeCurrentLoopId", () => {
  it("lowest-order non-terminal loop; tiebreak id; null when all terminal/empty", () => {
    expect(computeCurrentLoopId([{ id: "b", order: 2, status: "running" }, { id: "a", order: 1, status: "running" }])).toBe("a");
    expect(computeCurrentLoopId([{ id: "a", order: 1, status: "completed" }, { id: "b", order: 2, status: "running" }])).toBe("b");
    expect(computeCurrentLoopId([{ id: "a", order: 1, status: "failed" }])).toBeNull();
    expect(computeCurrentLoopId([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run → fail** — `cd functions && npm run test:run -- derive`.

- [ ] **Step 3: Implement** (`functions/src/derive.ts`) — add alongside the existing helpers (reuse the existing `byOrderThenId` comparator + `isTerminal`):

```typescript
export interface LoopLite { id: string; order: number; status: Status; }
/** Lowest-order non-terminal loop; tiebreak by id. Null if all terminal / none. */
export function computeCurrentLoopId(loops: LoopLite[]): string | null {
  const open = loops.filter((l) => !isTerminal(l.status)).sort(byOrderThenId);
  return open.length > 0 ? open[0].id : null;
}
```

- [ ] **Step 4: Run → pass.** **Step 5: Commit** `feat(api): computeCurrentLoopId derivation`.

---

## Task 2: `Loop` entity (schema + service + route + mount + tests)

**Files:** Create `functions/src/services/loops.ts`, `functions/src/routes/loops.ts`, `functions/test/loops.test.ts`; Modify `functions/src/schemas.ts`, `functions/src/app.ts`.

- [ ] **Step 1: Add `loopBody`** (`functions/src/schemas.ts`, before `keyMintBody`):

```typescript
export const loopBody = z.object({
  goal: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  order: z.number().int().optional(),
  status: status.optional(),
});
export type LoopBody = z.infer<typeof loopBody>;
```

- [ ] **Step 2: Failing test** (`functions/test/loops.test.ts`) — copy the goals.test.ts header (`seedTeam`/`createProject`), then:

```typescript
describe("PUT /v1/teams/:teamId/projects/:slug/loops/:loopId", () => {
  it("404s when the project does not exist", async () => {
    await seedTeam();
    expect((await request(app).put("/v1/teams/team1/projects/ghost/loops/l1").set(authHeader()).send({ goal: "build search", order: 1, status: "running" })).status).toBe(404);
  });
  it("requires goal+order+status on create", async () => {
    await createProject();
    expect((await request(app).put("/v1/teams/team1/projects/acme/loops/l1").set(authHeader()).send({ name: "x" })).status).toBe(400);
  });
  it("creates a loop, stamps startedAt, sets project.currentLoopId", async () => {
    await createProject();
    expect((await request(app).put("/v1/teams/team1/projects/acme/loops/l1").set(authHeader()).send({ goal: "search", order: 1, status: "running" })).status).toBe(200);
    expect((await db().doc("teams/team1/projects/acme/loops/l1").get()).data()!.goal).toBe("search");
    expect((await db().doc("teams/team1/projects/acme").get()).data()!.currentLoopId).toBe("l1");
  });
  it("advances currentLoopId when the current loop completes; null when all terminal", async () => {
    await createProject();
    await request(app).put("/v1/teams/team1/projects/acme/loops/l1").set(authHeader()).send({ goal: "a", order: 1, status: "running" });
    await request(app).put("/v1/teams/team1/projects/acme/loops/l2").set(authHeader()).send({ goal: "b", order: 2, status: "queued" });
    await request(app).put("/v1/teams/team1/projects/acme/loops/l1").set(authHeader()).send({ status: "completed" });
    expect((await db().doc("teams/team1/projects/acme").get()).data()!.currentLoopId).toBe("l2");
    await request(app).put("/v1/teams/team1/projects/acme/loops/l2").set(authHeader()).send({ status: "completed" });
    expect((await db().doc("teams/team1/projects/acme").get()).data()!.currentLoopId ?? null).toBeNull();
  });
});
```

- [ ] **Step 3: Run → fail.**

- [ ] **Step 4: Implement `services/loops.ts`** — mirror `upsertPhase`'s structure (transaction, project 404, required-on-create, startedAt/endedAt-once, recompute `currentLoopId` from the full loop set with this write applied):

```typescript
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import { isTerminal, type Status } from "../status.js";
import { computeCurrentLoopId } from "../derive.js";
import type { LoopBody } from "../schemas.js";

export async function upsertLoop(teamId: string, slug: string, loopId: string, body: LoopBody): Promise<void> {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const loopRef = projectRef.collection("loops").doc(loopId);
  await db().runTransaction(async (tx) => {
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
    const data: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (creating) { data.startedAt = FieldValue.serverTimestamp(); data.endedAt = null; }
    if (body.goal !== undefined) data.goal = body.goal;
    if (body.name !== undefined) data.name = body.name;
    if (body.order !== undefined) data.order = body.order;
    if (body.status !== undefined) data.status = body.status;
    if (isTerminal(newStatus) && !existing.endedAt) data.endedAt = FieldValue.serverTimestamp();

    const loops = loopsSnap.docs.filter((d) => d.id !== loopId)
      .map((d) => ({ id: d.id, order: d.data().order as number, status: d.data().status as Status }));
    loops.push({ id: loopId, order: newOrder, status: newStatus });
    const currentLoopId = computeCurrentLoopId(loops);

    tx.set(loopRef, data, { merge: true });
    tx.set(projectRef, { currentLoopId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}
```

- [ ] **Step 5: Implement `routes/loops.ts`** — mirror `routes/goals.ts` (validate teamId/slug/loopId via idPattern, `loopBody.safeParse`, call `upsertLoop`, `{ ok: true }`).

- [ ] **Step 6: Mount** (`functions/src/app.ts`) — add `import { loopsRouter }` and `teamRouter.use("/:slug/loops", loopsRouter)` (before the projects `/` catch-all; the loop-scoped entity mounts come in Task 5).

- [ ] **Step 7: Run → pass** (`npm test -- loops`). **Step 8: Commit** `feat(api): PUT loops entity with currentLoopId`.

---

## Task 3: Base-path-aware `phases` + `tasks`

**Files:** Modify `functions/src/services/phases.ts`, `functions/src/services/tasks.ts`; add loop-scoped tests to `functions/test/phases.test.ts`, `functions/test/tasks.test.ts` (existing tests are the regression guard).

- [ ] **Step 1: Add failing loop-scoped tests.**
  - `phases.test.ts`: create a loop `l1` (PUT loops/l1), then `PUT …/loops/l1/phases/p1` {name,order,status:running} → assert the phase doc exists at `loops/l1/phases/p1` AND `loops/l1` doc has `currentPhaseId==="p1"` (per-loop derivation on the loop doc), and the PROJECT doc's currentPhaseId is unchanged/untouched by the loop write.
  - `tasks.test.ts`: under `l1`, `PUT …/loops/l1/tasks/t1` {phaseId:p1,...} → task at `loops/l1/tasks/t1`; `loops/l1.currentTaskId==="t1"`; **`projects/acme.visionOwner==="loop"`** (stamp stays on project); project.currentTaskId untouched by the loop write.
  - Keep ALL existing project-direct phase/task tests (they must still pass).

- [ ] **Step 2: Run → fail** (the loop-scoped routes/params don't exist yet — these tests will be wired in Task 5; for Task 3, test the SERVICE directly by calling `upsertPhase(teamId, slug, phaseId, body, "l1")` / `upsertTask(..., "l1")` with the new `loopId` arg against the emulator, after seeding the loop via `upsertLoop`).

- [ ] **Step 3: Refactor `upsertPhase`** — add a trailing optional `loopId?: string`:
  - `const baseRef = loopId ? projectRef.collection("loops").doc(loopId) : projectRef;`
  - existence check on `baseRef` (404 "project or loop does not exist" when loopId, else today's "project does not exist"). Keep the `projectRef` reference for nothing else here (phases don't touch the project beyond the derived-id write).
  - read `phaseRef = baseRef.collection("phases").doc(phaseId)`, `phasesSnap = baseRef.collection("phases")`, `tasksSnap = baseRef.collection("tasks")`.
  - write phase under `baseRef`; write `{ currentPhaseId, currentTaskId, updatedAt }` to **`baseRef`** (loop doc when loop-scoped, project doc when legacy).
  - Everything else identical. For `loopId===undefined`, `baseRef===projectRef` → behavior byte-identical to today.

- [ ] **Step 4: Refactor `upsertTask`** — add `loopId?: string`:
  - `const baseRef = loopId ? projectRef.collection("loops").doc(loopId) : projectRef;`
  - existence check on `baseRef`.
  - read `taskRef`, `tasksSnap` from `baseRef`; read `currentPhaseId` from **`baseSnap.data()`** (the loop doc when loop-scoped; project doc when legacy).
  - write task under `baseRef`; write `{ currentTaskId, updatedAt }` to **`baseRef`**.
  - **ALWAYS** `tx.set(projectRef, { visionOwner: "loop", updatedAt: FieldValue.serverTimestamp() }, { merge: true })` — even when loop-scoped (project-level vision-ownership). When legacy, `baseRef===projectRef`, so fold both into one set `{ currentTaskId, visionOwner, updatedAt }` (today's exact write) to avoid a redundant double-write; when loop-scoped, two sets (base.currentTaskId + project.visionOwner). (Read `projectSnap` for the existence transitive check; visionOwner is a blind merge, no read needed.)

- [ ] **Step 5: Run → pass** — loop-scoped service tests + ALL existing phases/tasks tests green (`npm test -- phases tasks`).

- [ ] **Step 6: Commit** `refactor(api): base-path-aware upsertPhase/upsertTask (loop-scoped derivation; visionOwner stays on project)`.

---

## Task 4: Base-path-aware `taskCommits` + `events`

**Files:** Modify `functions/src/services/taskCommits.ts`, `functions/src/services/events.ts`; add loop-scoped tests to `functions/test/taskCommits.test.ts`, `functions/test/events.test.ts`.

- [ ] **Step 1: Failing loop-scoped tests** (call services with the new `loopId` arg after seeding a loop + a loop-scoped task/scenario):
  - `taskCommits`: `upsertTaskCommit(team, slug, taskId, sha, body, "l1")` → commit at `loops/l1/tasks/{taskId}/commits/{sha}`; 404 when the loop-scoped task is missing.
  - `events`: `appendScore(team, slug, body, "l1")` → score at `loops/l1/scores/{id}`; **scenario validation still reads the PROJECT scenario** (seed `projects/acme/scenarios/s1` at project level; a loop-scoped score for s1 validates against it; unknown criterion still 400). `appendTestRun`/`appendRevision` write under `loops/l1/...`.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Refactor `taskCommits.ts`** — `upsertTaskCommit(..., loopId?)`: `baseRef = loopId ? loops/{loopId} : projectRef`; `taskRef = baseRef.collection("tasks").doc(taskId)`; check task exists (404); write commit under `taskRef.collection("commits")`; bump `taskRef.updatedAt`. Legacy unchanged.

- [ ] **Step 4: Refactor `events.ts`** — add `loopId?` to `appendScore`/`appendTestRun`/`appendRevision`:
  - `const projectRef = await requireProject(teamId, slug);` then `const baseRef = loopId ? projectRef.collection("loops").doc(loopId) : projectRef;` and if `loopId`, verify the loop exists (404 "loop does not exist").
  - **`appendScore` reads the scenario from `projectRef.collection("scenarios")`** (NOT baseRef) — unchanged rubric validation.
  - write the event doc under `baseRef.collection("scores"|"testRuns"|"revisions")`. Keep the non-transactional `.set()`.

- [ ] **Step 5: Run → pass** — loop-scoped + existing taskCommits/events tests green.

- [ ] **Step 6: Commit** `refactor(api): base-path-aware taskCommits/events (scenario reads stay project-level)`.

---

## Task 5: Loop-scoped routes + mounts

**Files:** Modify `functions/src/routes/{phases,tasks,taskCommits,events}.ts`, `functions/src/app.ts`; add Supertest loop-scoped route tests.

- [ ] **Step 1: Pass `loopId` through each handler** — in `routes/phases.ts`, `routes/tasks.ts`, `routes/taskCommits.ts`, `routes/events.ts` (all three event routers), read `const { loopId } = req.params` (optional; present only on loop-scoped mounts) and pass it as the trailing arg to the service. Validate `loopId` with `idPattern` when present. (Legacy mounts have no `:loopId` param → undefined → unchanged.)

- [ ] **Step 2: Mount loop-scoped subtree** (`functions/src/app.ts`) — add, alongside the existing mounts (order: more specific first), the loop-scoped variants reusing the SAME routers:

```typescript
  teamRouter.use("/:slug/loops/:loopId/tasks/:taskId/commits", taskCommitsRouter);
  teamRouter.use("/:slug/loops/:loopId/tasks", tasksRouter);
  teamRouter.use("/:slug/loops/:loopId/phases", phasesRouter);
  teamRouter.use("/:slug/loops/:loopId/scores", scoresRouter);
  teamRouter.use("/:slug/loops/:loopId/testRuns", testRunsRouter);
  teamRouter.use("/:slug/loops/:loopId/revisions", revisionsRouter);
  teamRouter.use("/:slug/loops", loopsRouter);     // loop entity (Task 2)
```
(Routers already use `Router({ mergeParams: true })`, so `:loopId` propagates. Keep the legacy `/:slug/phases…` etc. mounts unchanged. Ensure `/:slug/loops/:loopId/...` specific mounts precede `/:slug/loops`.)

- [ ] **Step 3: Supertest loop-scoped routes** (`functions/test/loops.test.ts` or the entity tests) — exercise the full HTTP path: create loop → `PUT …/loops/l1/phases/p1` → `PUT …/loops/l1/tasks/t1` → `PUT …/loops/l1/tasks/t1/commits/abc` → `POST …/loops/l1/scores` (with a project scenario seeded) → assert docs land under `loops/l1/...` and `loops/l1` has currentPhaseId/currentTaskId.

- [ ] **Step 4: Run → pass** — `npm test` (full): loop-scoped routes green + ALL #1 tests green.

- [ ] **Step 5: Commit** `feat(api): loop-scoped route mounts (reuse entity routers under /loops/:loopId)`.

---

## Task 6: CLI — `loop start/set` + loop-aware reporting

**Files:** Modify `cli/daloop.mjs`, `functions/test/cli.unit.test.ts`.

- [ ] **Step 1: Failing unit tests** (`cli.unit.test.ts`):
  - `loop start <id> --goal "…" --order 1` → PUT `…/projects/web/loops/<id>` body `{goal,order,status:"running"}`; sets `cfg.currentLoopId`.
  - `loop set <id> --status completed` → PUT `…/loops/<id>` `{status}`.
  - With `cfg.currentLoopId="l1"`: `task start t1 --phase p1 --name T --order 1` → URL `…/projects/web/loops/l1/tasks/t1`; `score s1 --task t1 --composite 80 --criterion c=3` → `…/loops/l1/scores`; `commit` → `…/loops/l1/tasks/<task>/commits/<sha>`.
  - WITHOUT currentLoopId (legacy): the existing project-direct URLs (unchanged) — keep/adjust the existing tests.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement in `cli/daloop.mjs`:**
  - Add a helper `loopSeg(cfg)` → `cfg.currentLoopId ? "/loops/" + cfg.currentLoopId : ""`. Insert it into the URL builders for `phase start`, `phase set`, `task start`, `task set`, `commit`, `score`, `test-run`, `revise` (between `/projects/<slug>` and the entity path). Legacy (no currentLoopId) → empty segment → today's URLs.
  - Add `case "loop start": { id=positionals[2]; require --goal,--order; PUT /loops/<id> {goal,order,status:status||running}; cfg.currentLoopId=id; cfg.loops[id]={goal,order}; saveConfig }` and `case "loop set": { PUT /loops/<id> {status} }` (validateStatus). Add `loop` to the ONE_WORD-style dispatch? No — `loop start`/`loop set` are two-word verbs (cmd="loop", sub="start"/"set") → fit the existing `${cmd} ${sub}` switch. Good.
  - `init`: seed `currentLoopId: null, loops: {}`.

- [ ] **Step 4: Run → pass** — `npm run test:run -- cli.unit` (new + existing; adjust existing commit/task tests for the now-optional loop segment — with no currentLoopId they're unchanged).

- [ ] **Step 5: Sync + commit** — `bash scripts/sync-daloop-cli.sh`; `git add cli/daloop.mjs functions/test/cli.unit.test.ts web/public/skill/daloop.mjs plugins/daloop-reporting/bin/daloop && git commit -m "feat(cli): loop start/set + loop-aware reporting (currentLoopId)"`.

---

## Task 7: Rules tests for `loops/**`

**Files:** Modify `functions/test-rules/rules.test.ts`.

- [ ] **Step 1:** extend `seedProjectTree` to also seed `loops/l1` + `loops/l1/phases/p1`, `loops/l1/tasks/t1`, `loops/l1/tasks/t1/commits/c1`, `loops/l1/scores/01X`. Add a describe asserting a member can read each; a non-member cannot; a client write is denied. (No rules change — the recursive `match /projects/{slug}/{document=**}` covers them; the test proves it.)

- [ ] **Step 2: Run → pass** — `npm run test:rules`. **Step 3: Commit** `test(rules): loop subcollections member-read/client-write-deny`.

---

## Task 8: Verification

- [ ] `cd functions && npm test` — ALL green: loop entity, loop-scoped phase/task/commit/events, per-loop derivation, currentLoopId, **and every pre-existing #1/#5/#6 test (no regression from the base-path refactor)**.
- [ ] `npm run build` clean ; `npm run test:rules` green.
- [ ] `cd functions && npm test -- cli` (or the running-emulator form) — CLI loop verbs + loop-aware URLs + legacy URLs unchanged.
- [ ] Confirm: legacy project-direct writes byte-identical (visionOwner still on project; project currentPhaseId/currentTaskId still maintained); loop-scoped writes land under `loops/{id}` with per-loop derived ids; scenario reads project-level.
- [ ] **Deploy (v2.1): functions + CLI re-sync (hosting for the curl copy). Rules unchanged — no rules deploy needed, but harmless to include.**

---

## Notes for the executor
- **Regression is the #1 risk.** After EACH service refactor, run that service's existing tests — they must pass unchanged (legacy `baseRef===projectRef`).
- **The boundary invariants are non-negotiable:** scenario reads + visionOwner stamp stay on the project; per-loop derivation on the loop doc. Re-read the Background section.
- Vision services (project/goals/scenarios/documents, `/v1/u`) get NO loopId — don't touch them.
- Reads-before-writes; keep `appendScore` non-transactional.
- No new deps. Do NOT `git add -A`.
