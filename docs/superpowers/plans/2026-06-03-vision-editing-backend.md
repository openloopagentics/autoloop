# Vision Editing — Backend Write-Path Implementation Plan (#5a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-authenticated (Firebase ID token + team membership), server-mediated write path (`/v1/u/teams/:teamId/projects/...`) that lets a signed-in member create/edit/delete a project's vision (project, goals, scenarios, documents) — guarded so it only works on web-owned projects, with a `visionOwner` flag that agent writes set to `"loop"` (loop wins).

**Architecture:** Refactor each existing entity upsert into a pure `applyXUpsert(tx, …, owner)` inner helper + keep the agent public wrapper (which now stamps `visionOwner:"loop"` in the same transaction). New `requireMember` middleware composes after `makeRequireUser`. A new `userProjectsRouter` runs each write in ONE transaction: read project → `assertWebEditable` → `applyXUpsert(tx,…,"web")`. New delete services. Firestore rules unchanged (Admin-SDK server writes).

**Tech Stack:** TypeScript Cloud Function (Express + firebase-admin + zod), Vitest + Firestore emulator (`functions/test/`). No new deps. The web UI (#5b) is a separate plan that consumes these endpoints.

**Reference spec:** `docs/superpowers/specs/2026-06-03-vision-editing-design.md`

---

## Background / conventions (read before Task 1)

- **Auth modes are separate by URL subtree.** Agent writes: `/v1/teams/...` + `requireApiKeyMember` (unchanged). New user writes: `/v1/u/teams/:teamId/projects/...` + `makeRequireUser()` + `requireMember`. `makeRequireUser` (in `functions/src/requireUser.ts`) already verifies the ID token, enforces `users/{uid}.isAllowed`, and sets `req.uid`.
- **No nested transactions.** The Admin SDK forbids `runTransaction` inside `runTransaction`. So each existing upsert is split: a pure `applyXUpsert(tx, projectRef, ref, body, owner)` (assumes the project snapshot was already read/validated by the caller) + a thin public wrapper that opens the transaction. Agent wrapper → `"loop"`; web router → reads project, `assertWebEditable`, `applyXUpsert(tx,…,"web")`. **All reads (project snap, entity snap) happen before any `tx.set`.**
- **`visionOwner` stamping:** the agent wrapper adds `tx.set(projectRef, { visionOwner: "loop", updatedAt: serverTimestamp() }, { merge: true })` inside its transaction; the web path stamps `"web"`. Stamp on goals/scenarios/documents/tasks upserts only — NOT on bare `project set`/`phase` (a bare status board stays web-editable). `upsertTask` already writes the project doc; the others add one in-transaction project write.
- **Rules unchanged:** `firestore.rules` keeps `allow write: if false` (recursive). All writes are Admin-SDK (server) and bypass rules. The existing `rules.test.ts` "loop-contract subcollections" block already asserts clients cannot write goals/scenarios/documents — **no new rules work**; just don't change the rules file.
- **Test harness:** `functions/test/*.test.ts`, Supertest + emulator (`helpers.ts` clears Firestore + seeds the test API key each test). For the **ID-token** path, build a local express app mounting `makeRequireUser(stubVerify)` + `requireMember` + `userProjectsRouter` (mirror `functions/test/requireUser.test.ts`'s `stubVerify = token → /^good-(.+)$/`), and `errorHandler`. Seed `users/{uid}.isAllowed` + `teams/{teamId}/members/{uid}`.
- **Commands:** `cd functions && npm test` (boots emulator) ; single file `npm run test:run -- <name>` (needs a running emulator) ; `npm run build` (tsc). Do NOT `git add -A` (`.DS_Store`/`prototype/` stay untracked).

## File structure

| File | Responsibility | Task |
|---|---|---|
| `functions/src/requireMember.ts` | ID-token-user team-membership middleware | 1 |
| `functions/src/services/visionOwner.ts` | `assertWebEditable(projectSnap)` guard | 2 |
| `functions/src/services/goals.ts` | split `applyGoalUpsert(tx,…,owner)` + agent wrapper stamps "loop"; add `deleteGoal` | 3 |
| `functions/src/services/scenarios.ts` | same split + `deleteScenario` | 4 |
| `functions/src/services/documents.ts` | same split + `deleteDocument` | 4 |
| `functions/src/services/tasks.ts` | stamp `visionOwner:"loop"` in the existing project write | 4 |
| `functions/src/services/projects.ts` | split `applyProjectUpsert(tx, teamRef, ref, slug, body, owner?)` | 5 |
| `functions/src/routes/userProjects.ts` | the `/v1/u` router (PUT project/goals/scenarios/documents + DELETE) | 6 |
| `functions/src/app.ts` | mount the `/v1/u/...` subtree | 6 |
| `functions/test/{requireMember,userProjects,visionOwner}.test.ts` | tests | 1,2,6 |

---

## Task 1: `requireMember` middleware

**Files:** Create `functions/src/requireMember.ts`, `functions/test/requireMember.test.ts`.

- [ ] **Step 1: Write the failing test** (`functions/test/requireMember.test.ts`)

```typescript
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import "./helpers.js";
import { db } from "../src/firestore.js";
import { requireMember } from "../src/requireMember.js";
import { errorHandler } from "../src/errors.js";

// stand-in for makeRequireUser: set req.uid from a header so we test membership alone
function app() {
  const a = express();
  a.use("/v1/u/teams/:teamId/projects", (req, _res, next) => { (req as { uid?: string }).uid = req.header("x-uid") || undefined; next(); }, requireMember, (_req, res) => res.json({ ok: true }));
  a.use(errorHandler);
  return a;
}

describe("requireMember", () => {
  it("403 when uid is not a member of the team", async () => {
    await db().doc("teams/t1").set({ name: "T", createdBy: "x" });
    const res = await request(app()).get("/v1/u/teams/t1/projects").set("x-uid", "bob");
    expect(res.status).toBe(403);
  });
  it("passes when uid is a member", async () => {
    await db().doc("teams/t1").set({ name: "T", createdBy: "x" });
    await db().doc("teams/t1/members/alice").set({ uid: "alice", role: "member" });
    const res = await request(app()).get("/v1/u/teams/t1/projects").set("x-uid", "alice");
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd functions && npm test -- requireMember` → FAIL (module not found).

- [ ] **Step 3: Implement** (`functions/src/requireMember.ts`)

```typescript
import type { RequestHandler } from "express";
import { db } from "./firestore.js";
import { AppError } from "./errors.js";

/**
 * Authorizes an already-authenticated user (req.uid, set by makeRequireUser) against
 * the path's :teamId. Mount AFTER makeRequireUser on a mergeParams subtree.
 */
export const requireMember: RequestHandler = async (req, _res, next) => {
  try {
    const uid = (req as { uid?: string }).uid;
    if (!uid) throw new AppError(401, "unauthorized", "missing user");
    const { teamId } = req.params as { teamId: string };
    const memberSnap = await db().doc(`teams/${teamId}/members/${uid}`).get();
    if (!memberSnap.exists) throw new AppError(403, "forbidden", "not a member of this team");
    next();
  } catch (err) {
    next(err);
  }
};
```

- [ ] **Step 4: Run to verify it passes** — `cd functions && npm test -- requireMember` → PASS (2).

- [ ] **Step 5: Commit**
```bash
git add functions/src/requireMember.ts functions/test/requireMember.test.ts
git commit -m "feat(api): requireMember middleware (ID-token user → team membership)"
```

---

## Task 2: `assertWebEditable` ownership guard

**Files:** Create `functions/src/services/visionOwner.ts`, `functions/test/visionOwner.test.ts`.

- [ ] **Step 1: Write the failing test** (`functions/test/visionOwner.test.ts`)

```typescript
import { describe, it, expect } from "vitest";
import { assertWebEditable } from "../src/services/visionOwner.js";
import { AppError } from "../src/errors.js";

function snap(exists: boolean, data?: Record<string, unknown>) {
  return { exists, data: () => data } as unknown as FirebaseFirestore.DocumentSnapshot;
}

describe("assertWebEditable", () => {
  it("throws 404 when the project is missing", () => {
    try { assertWebEditable(snap(false)); throw new Error("no throw"); }
    catch (e) { expect((e as AppError).httpStatus).toBe(404); }
  });
  it("throws 409 when visionOwner === 'loop'", () => {
    try { assertWebEditable(snap(true, { visionOwner: "loop" })); throw new Error("no throw"); }
    catch (e) { expect((e as AppError).httpStatus).toBe(409); }
  });
  it("passes when visionOwner is 'web' or absent", () => {
    expect(() => assertWebEditable(snap(true, { visionOwner: "web" }))).not.toThrow();
    expect(() => assertWebEditable(snap(true, {}))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd functions && npm run test:run -- visionOwner` → FAIL (standalone; no emulator needed).

- [ ] **Step 3: Implement** (`functions/src/services/visionOwner.ts`)

```typescript
import { AppError } from "../errors.js";

/** Guard for the web write path: the project must exist and not be loop-owned. */
export function assertWebEditable(projectSnap: FirebaseFirestore.DocumentSnapshot): void {
  if (!projectSnap.exists) throw new AppError(404, "not_found", "project does not exist");
  if (projectSnap.data()?.visionOwner === "loop") {
    throw new AppError(409, "conflict", "project is loop-owned (read-only in the web)");
  }
}
```

- [ ] **Step 4: Run to verify it passes** — `cd functions && npm run test:run -- visionOwner` → PASS (3).

- [ ] **Step 5: Commit**
```bash
git add functions/src/services/visionOwner.ts functions/test/visionOwner.test.ts
git commit -m "feat(api): assertWebEditable ownership guard"
```

---

## Task 3: Refactor `goals` service to inner helper + agent "loop" stamp + `deleteGoal` (the template)

**Files:** Modify `functions/src/services/goals.ts`. (Existing `functions/test/goals.test.ts` is the regression guard + add one stamp assertion.)

- [ ] **Step 1: Add a failing regression+stamp test** (append to `functions/test/goals.test.ts`, inside the existing describe)

```typescript
  it("stamps visionOwner 'loop' on the project when an agent upserts a goal", async () => {
    await createProject();
    await request(app).put("/v1/teams/team1/projects/acme/goals/g1").set(authHeader()).send({ title: "Ship" });
    const proj = (await db().doc("teams/team1/projects/acme").get()).data()!;
    expect(proj.visionOwner).toBe("loop");
  });
```

- [ ] **Step 2: Run to verify it fails** — `cd functions && npm test -- goals` → the new test FAILs (visionOwner undefined); existing pass.

- [ ] **Step 3: Refactor `functions/src/services/goals.ts`**

Split the body into a pure inner helper and a wrapper. Read the current file first; produce:

```typescript
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import type { GoalBody } from "../schemas.js";

type Tx = FirebaseFirestore.Transaction;
type Ref = FirebaseFirestore.DocumentReference;

/** Apply a goal upsert within an OPEN transaction (project already read/validated by caller).
 *  Stamps the project's visionOwner to `owner`. Reads goalRef before any write. */
export async function applyGoalUpsert(tx: Tx, projectRef: Ref, goalRef: Ref, body: GoalBody, owner: "web" | "loop"): Promise<void> {
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
  tx.set(projectRef, { visionOwner: owner, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

/** Agent path: open a transaction, require the project, apply with owner "loop". */
export async function upsertGoal(teamId: string, slug: string, goalId: string, body: GoalBody): Promise<void> {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const goalRef = projectRef.collection("goals").doc(goalId);
  await db().runTransaction(async (tx) => {
    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists) throw new AppError(404, "not_found", "project does not exist");
    await applyGoalUpsert(tx, projectRef, goalRef, body, "loop");
  });
}

/** Web/delete path: delete a goal; caller guards web-editability. */
export async function deleteGoal(teamId: string, slug: string, goalId: string): Promise<void> {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const goalRef = projectRef.collection("goals").doc(goalId);
  await db().runTransaction(async (tx) => {
    const projectSnap = await tx.get(projectRef);
    const { assertWebEditable } = await import("./visionOwner.js");
    assertWebEditable(projectSnap);
    tx.delete(goalRef);
  });
}
```

NOTE: prefer a top-of-file `import { assertWebEditable } from "./visionOwner.js";` over the inline dynamic import shown above — use the static import.

CRITICAL: the transaction reads (`tx.get(projectRef)`, then inside `applyGoalUpsert` `tx.get(goalRef)`) both occur before any `tx.set` — preserve that ordering.

- [ ] **Step 4: Run to verify all goals tests pass** — `cd functions && npm test -- goals` → PASS (existing + the new stamp test).

- [ ] **Step 5: Commit**
```bash
git add functions/src/services/goals.ts functions/test/goals.test.ts
git commit -m "refactor(api): goals service → applyGoalUpsert(tx,owner) + loop stamp; add deleteGoal"
```

---

## Task 4: Same refactor for scenarios + documents; `visionOwner` stamp in tasks

**Files:** Modify `functions/src/services/scenarios.ts`, `documents.ts`, `tasks.ts`. Add stamp assertions to `scenarios.test.ts`, `documents.test.ts`, `tasks.test.ts`.

- [ ] **Step 1: Add failing stamp tests** (one per file, mirroring Task 3's test)
  - `scenarios.test.ts`: after creating a scenario, assert project `visionOwner === "loop"`.
  - `documents.test.ts`: after creating a document, assert `visionOwner === "loop"`.
  - `tasks.test.ts`: after creating a task, assert `visionOwner === "loop"`.

- [ ] **Step 2: Run to verify they fail** — `cd functions && npm test -- scenarios documents tasks` → new asserts FAIL.

- [ ] **Step 3: Refactor each service** following Task 3's template exactly:
  - `scenarios.ts`: `applyScenarioUpsert(tx, projectRef, ref, body, owner)` (required-on-create goalId+title+rubric) + stamp; `upsertScenario` wrapper (project 404 → apply "loop"); `deleteScenario(teamId, slug, scenarioId)`.
  - `documents.ts`: `applyDocumentUpsert(tx, projectRef, ref, body, owner)` (required-on-create kind+title+format+content) + stamp; `upsertDocument` wrapper; `deleteDocument(teamId, slug, docId)`.
  - `tasks.ts`: in the EXISTING `upsertTask` transaction, the final `tx.set(projectRef, { currentTaskId, updatedAt })` gains `visionOwner: "loop"`. (No inner-helper split needed for tasks — the web path doesn't write tasks; only the stamp matters. Keep `upsertTask` otherwise unchanged.)

- [ ] **Step 4: Run to verify all pass** — `cd functions && npm test -- scenarios documents tasks` → PASS (existing + stamps). Then `npm test` full → all green.

- [ ] **Step 5: Commit**
```bash
git add functions/src/services/scenarios.ts functions/src/services/documents.ts functions/src/services/tasks.ts functions/test/scenarios.test.ts functions/test/documents.test.ts functions/test/tasks.test.ts
git commit -m "refactor(api): scenarios/documents → apply*(tx,owner)+deletes; tasks stamps loop owner"
```

---

## Task 5: Split `applyProjectUpsert` from `upsertProject`

**Files:** Modify `functions/src/services/projects.ts`. (Existing `projects.test.ts` is the regression guard.)

- [ ] **Step 1: Refactor** — read the current `upsertProject` (it requires the team doc to exist, sets slug/createdAt/currentPhaseId:null on create). Split into:

```typescript
export async function applyProjectUpsert(tx: Tx, teamRef: Ref, ref: Ref, slug: string, body: ProjectBody, owner?: "web" | "loop"): Promise<void> {
  const teamSnap = await tx.get(teamRef);
  if (!teamSnap.exists) throw new AppError(404, "not_found", "team does not exist");
  const snap = await tx.get(ref);
  const creating = !snap.exists;
  if (creating && (!body.title || !body.status)) {
    throw new AppError(400, "validation", "title and status are required when creating a project");
  }
  const data: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (creating) { data.slug = slug; data.createdAt = FieldValue.serverTimestamp(); data.currentPhaseId = null; }
  if (body.title !== undefined) data.title = body.title;
  if (body.status !== undefined) data.status = body.status;
  if (body.design !== undefined) data.design = { ...body.design, updatedAt: FieldValue.serverTimestamp() };
  if (owner !== undefined) data.visionOwner = owner;
  tx.set(ref, data, { merge: true });
}

export async function upsertProject(teamId: string, slug: string, body: ProjectBody): Promise<void> {
  const teamRef = db().doc(`teams/${teamId}`);
  const ref = db().doc(`teams/${teamId}/projects/${slug}`);
  await db().runTransaction((tx) => applyProjectUpsert(tx, teamRef, ref, slug, body)); // owner undefined: bare project set doesn't stamp
}
```

(The web router create path will call `applyProjectUpsert(tx, …, "web")`. Note the web create requires `title`+`status` like the agent path — the web form supplies a default status `running`.)

- [ ] **Step 2: Run to verify** — `cd functions && npm test -- projects` → existing projects tests PASS (behavior identical; owner undefined on the agent path).

- [ ] **Step 3: Commit**
```bash
git add functions/src/services/projects.ts
git commit -m "refactor(api): split applyProjectUpsert(tx,owner) from upsertProject"
```

---

## Task 6: `userProjectsRouter` + mount + Supertest

**Files:** Create `functions/src/routes/userProjects.ts`, `functions/test/userProjects.test.ts`; Modify `functions/src/app.ts`.

- [ ] **Step 1: Write the failing test** (`functions/test/userProjects.test.ts`)

Build a local app with a stub verifier (mirror `requireUser.test.ts`):

```typescript
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import "./helpers.js";
import { db } from "../src/firestore.js";
import { makeRequireUser } from "../src/requireUser.js";
import { requireMember } from "../src/requireMember.js";
import { userProjectsRouter } from "../src/routes/userProjects.js";
import { errorHandler } from "../src/errors.js";

const stubVerify = async (t: string) => { const m = t.match(/^good-(.+)$/); if (!m) throw new Error("x"); return { uid: m[1] }; };
function app() {
  const a = express();
  a.use(express.json());
  a.use("/v1/u/teams/:teamId/projects", makeRequireUser(stubVerify), requireMember, userProjectsRouter);
  a.use(errorHandler);
  return a;
}
const tok = (uid: string) => ({ Authorization: `Bearer good-${uid}` });
async function seed(uid = "alice") {
  await db().doc(`users/${uid}`).set({ email: `${uid}@x.com`, isAllowed: true });
  await db().doc("teams/t1").set({ name: "T", createdBy: uid });
  await db().doc(`teams/t1/members/${uid}`).set({ uid, role: "member" });
}
const rubric = { criteria: [{ id: "c", name: "C", weight: 1, max: 5 }] };

describe("user vision write path", () => {
  it("creates a web project (visionOwner web), then goal/scenario/document", async () => {
    await seed();
    expect((await request(app()).put("/v1/u/teams/t1/projects/web").set(tok("alice")).send({ title: "Web", status: "running" })).status).toBe(200);
    let p = (await db().doc("teams/t1/projects/web").get()).data()!;
    expect(p.visionOwner).toBe("web");
    expect((await request(app()).put("/v1/u/teams/t1/projects/web/goals/g1").set(tok("alice")).send({ title: "G" })).status).toBe(200);
    expect((await request(app()).put("/v1/u/teams/t1/projects/web/scenarios/s1").set(tok("alice")).send({ goalId: "g1", title: "S", rubric })).status).toBe(200);
    expect((await request(app()).put("/v1/u/teams/t1/projects/web/documents/d1").set(tok("alice")).send({ kind: "vision", title: "V", format: "markdown", content: "# V" })).status).toBe(200);
    expect((await db().doc("teams/t1/projects/web/scenarios/s1").get()).data()!.title).toBe("S");
  });
  it("403 for a non-member; 401 for a bad token", async () => {
    await seed();
    await db().doc("users/bob").set({ email: "b@x.com", isAllowed: true });
    expect((await request(app()).put("/v1/u/teams/t1/projects/web").set(tok("bob")).send({ title: "W", status: "running" })).status).toBe(403);
    expect((await request(app()).put("/v1/u/teams/t1/projects/web").set({ Authorization: "Bearer nope" }).send({ title: "W", status: "running" })).status).toBe(401);
  });
  it("409 when the project is loop-owned", async () => {
    await seed();
    await db().doc("teams/t1/projects/web").set({ slug: "web", title: "W", status: "running", visionOwner: "loop" });
    expect((await request(app()).put("/v1/u/teams/t1/projects/web/goals/g1").set(tok("alice")).send({ title: "G" })).status).toBe(409);
  });
  it("deletes a goal", async () => {
    await seed();
    await request(app()).put("/v1/u/teams/t1/projects/web").set(tok("alice")).send({ title: "W", status: "running" });
    await request(app()).put("/v1/u/teams/t1/projects/web/goals/g1").set(tok("alice")).send({ title: "G" });
    expect((await request(app()).delete("/v1/u/teams/t1/projects/web/goals/g1").set(tok("alice"))).status).toBe(200);
    expect((await db().doc("teams/t1/projects/web/goals/g1").get()).exists).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd functions && npm test -- userProjects` → FAIL.

- [ ] **Step 3: Implement `userProjects.ts`** — `Router({ mergeParams: true })`. Each handler validates path ids with `idPattern`, `safeParse`s the body schema, and runs ONE `db().runTransaction` that reads the project, calls `assertWebEditable` (for entity writes; for project PUT, see below), applies the matching `apply*Upsert(tx,…,"web")`, and responds `{ ok: true }`. Project create uses `applyProjectUpsert(tx, teamRef, ref, slug, body, "web")` (which itself reads team + project). Sketch for goals (others mirror):

```typescript
import { Router } from "express";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import { idPattern, projectBody, goalBody, scenarioBody, documentBody } from "../schemas.js";
import { assertWebEditable } from "../services/visionOwner.js";
import { applyProjectUpsert } from "../services/projects.js";
import { applyGoalUpsert, deleteGoal } from "../services/goals.js";
import { applyScenarioUpsert, deleteScenario } from "../services/scenarios.js";
import { applyDocumentUpsert, deleteDocument } from "../services/documents.js";

export const userProjectsRouter = Router({ mergeParams: true });

function ids(req: { params: Record<string, string> }, names: string[]) {
  for (const n of names) if (!idPattern.test(req.params[n] ?? "")) throw new AppError(400, "validation", `invalid ${n}`);
}

userProjectsRouter.put("/:slug", async (req, res, next) => {
  try {
    ids(req, ["teamId", "slug"]);
    const parsed = projectBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const { teamId, slug } = req.params as Record<string, string>;
    const teamRef = db().doc(`teams/${teamId}`);
    const ref = db().doc(`teams/${teamId}/projects/${slug}`);
    await db().runTransaction(async (tx) => {
      const projSnap = await tx.get(ref);
      if (projSnap.exists) assertWebEditable(projSnap); // patch must not be loop-owned; create is fine
      await applyProjectUpsert(tx, teamRef, ref, slug, parsed.data, "web");
    });
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});

// goals: PUT /:slug/goals/:goalId  and  DELETE /:slug/goals/:goalId
userProjectsRouter.put("/:slug/goals/:goalId", async (req, res, next) => {
  try {
    ids(req, ["teamId", "slug", "goalId"]);
    const parsed = goalBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const { teamId, slug, goalId } = req.params as Record<string, string>;
    const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
    const goalRef = projectRef.collection("goals").doc(goalId);
    await db().runTransaction(async (tx) => {
      const projSnap = await tx.get(projectRef);
      assertWebEditable(projSnap);
      await applyGoalUpsert(tx, projectRef, goalRef, parsed.data, "web");
    });
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});
userProjectsRouter.delete("/:slug/goals/:goalId", async (req, res, next) => {
  try {
    ids(req, ["teamId", "slug", "goalId"]);
    const { teamId, slug, goalId } = req.params as Record<string, string>;
    await deleteGoal(teamId, slug, goalId);
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});
// scenarios + documents: identical shape with scenarioBody/applyScenarioUpsert/deleteScenario and documentBody/applyDocumentUpsert/deleteDocument.
```

Implement the scenarios and documents PUT/DELETE the same way.

- [ ] **Step 4: Mount** (`functions/src/app.ts`) — add the import and, after the agent `teamRouter` mount:
```typescript
import { userProjectsRouter } from "./routes/userProjects.js";
// …
  app.use("/v1/u/teams/:teamId/projects", makeRequireUser(), requireMember, userProjectsRouter);
```
(Import `requireMember` from `./requireMember.js`. Place the line after the `app.use("/v1/teams/:teamId/projects", requireApiKeyMember, teamRouter);` line and before the unknown-route 404.)

- [ ] **Step 5: Run to verify it passes** — `cd functions && npm test -- userProjects` → PASS; then `npm test` full → all green; then `npm run build` → clean.

- [ ] **Step 6: Commit**
```bash
git add functions/src/routes/userProjects.ts functions/src/app.ts functions/test/userProjects.test.ts
git commit -m "feat(api): /v1/u user vision write path (PUT project/goals/scenarios/documents + DELETE)"
```

---

## Task 7: Verification

**Files:** none.

- [ ] **Step 1: Full functions suite** — `cd functions && npm test` → all green (existing + requireMember + visionOwner + userProjects + the agent stamp tests).
- [ ] **Step 2: Build** — `cd functions && npm run build` → 0 errors.
- [ ] **Step 3: Rules unchanged** — confirm `git diff --stat` shows NO change to `firestore.rules`; the existing `rules.test.ts` already asserts clients can't write goals/scenarios/documents (run `npm run test:rules` → green). No new rules work.
- [ ] **Step 4: Confirm success criteria** — web path creates/edits/deletes vision entities (ID token + membership), stamps `visionOwner:"web"`; agent writes stamp `"loop"`; web write to a loop-owned project → 409; non-member → 403; rules unchanged.
- [ ] **Step 5: Final commit (if any fixes)** — `git add -A -- functions && git commit -m "chore: vision-editing backend verification"`.

---

## Notes for the executor
- **Reads before writes** in every transaction (project snap + entity snap, then `tx.set`).
- **Don't change `firestore.rules`** — all writes are Admin-SDK server-side.
- The agent stamp (`visionOwner:"loop"`) goes ONLY on goals/scenarios/documents/tasks upserts — NOT on `project set`/`phase`/commits/events. Verify the existing phase/commit/event tests stay green (they don't touch visionOwner).
- Keep `applyXUpsert` reads-before-writes and the existing required-on-create messages identical (regression).
- Use static `import { assertWebEditable } from "../services/visionOwner.js"` (not dynamic import).
- Do NOT `git add -A` broadly; add named paths.
