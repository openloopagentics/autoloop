# Vision growth via auditable diffs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the loop grow the vision (new goals/scenarios, rubric/threshold updates) through recorded, revertable `visionChanges` events — applied immediately (autonomous-with-veto), each carrying a `prior` snapshot and a required `reason`, with a one-click user **Reject** that restores the prior state even while the loop owns the vision.

**Architecture:** A new project-level append-only event, `visionChanges/{ulid}`, written by ONE agent endpoint (`POST …/vision-changes`) that applies the upsert and records the change **atomically in one transaction**: the service does its own `tx.get(targetRef)` to capture `prior` BEFORE dispatching on `op` to the existing exported `applyGoalUpsert` / `applyScenarioUpsert` inner `(tx, …, owner)` helpers with owner `"loop"` — apply semantics (create-gates, merge, `visionOwner: "loop"` stamp) are byte-identical to a plain agent goal/scenario PUT. The helpers re-read the target inside the same transaction; that duplicate read is **deliberate** (Firestore transactions are snapshot-consistent and both reads precede all writes) — do NOT refactor the helpers to accept a pre-read snapshot. Reject is a **user** endpoint on the `/v1/u/` subtree that restores `prior` wholesale with `set` (no merge — added fields removed), re-stamps `updatedAt`, deletes the target when `prior` is `null`, marks the change `rejected` + `decidedAt`, is idempotent, never touches `visionOwner`, and deliberately does **not** call `assertWebEditable` (like the messages POST, unlike normal web vision edits). No `firestore.rules` change — the recursive `match /projects/{slug}/{document=**}` member-read already covers `visionChanges/{id}`; rules tests only.

**Tech Stack:** Firebase Cloud Functions v2 (TypeScript, Firestore Admin SDK), Express routers, zod validation, Vitest + Firestore emulator + `@firebase/rules-unit-testing`, dependency-free Node CLI (`cli/autoloop.mjs`), React 18 + Firestore listeners + Vitest/Testing-Library (web).

**Spec:** `docs/superpowers/specs/2026-06-09-vision-growth-design.md`

**Conventions (read before starting):**
- Run a single functions test file with the emulator already running (`cd functions && npm run emulators` in another shell): `cd functions && npm run test:run -- <name>`. The full main suite (spins up the emulator itself) is `cd functions && npm test`. Rules tests are a **separate config, NOT included in `npm test`**: `cd functions && npm run test:rules`. Web tests: `cd web && npm test`. Builds: `cd functions && npm run build` and `cd web && npm run build`.
- Entity bodies enforce required-on-create in the **service layer**, not zod (zod marks fields optional). The vision-change payload is re-validated **per-op** in the service with the existing `goalBody`/`scenarioBody` so error messages match direct upserts exactly.
- `idPattern` is lowercase-only; ULID doc ids (change ids) are UPPERCASE Crockford base32. Path params that carry a ULID are validated only as non-empty (precedent: `messagesRouter.post("/:id/ack")` in `functions/src/routes/messages.ts`), never with `idPattern`.
- The canonical CLI is `cli/autoloop.mjs` with two distribution copies (`web/public/skill/autoloop.mjs`, `plugins/autoloop/bin/autoloop`) — resync all three via `bash scripts/sync-autoloop-cli.sh` after any CLI edit. The same script also syncs the driver skill copy `plugins/autoloop/skills/autoloop/SKILL.md` → `web/public/skill/autoloop/SKILL.md`.
- The driver-skill change ships with a plugin version bump in `plugins/autoloop/.claude-plugin/plugin.json` (currently `0.10.1` → `0.11.0`).
- Commit messages end with the trailer:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: `visionChangeBody` schema

**Files:**
- Modify: `functions/src/schemas.ts` (add after the `revisionBody` block, ~line 131 — it reuses the `id` const declared above)
- Test: `functions/test/schemas.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `functions/test/schemas.test.ts` (extend the existing import line from `../src/schemas.js` with `visionChangeBody`):

```ts
describe("visionChangeBody", () => {
  const base = { op: "upsert-goal", targetId: "g1", payload: { title: "G" }, reason: "learned X" };
  it("accepts a minimal change", () => {
    expect(visionChangeBody.safeParse(base).success).toBe(true);
  });
  it("accepts an optional originLoopId", () => {
    expect(visionChangeBody.safeParse({ ...base, originLoopId: "loop-2026-06-09" }).success).toBe(true);
  });
  it("accepts upsert-scenario", () => {
    expect(visionChangeBody.safeParse({ ...base, op: "upsert-scenario" }).success).toBe(true);
  });
  it("rejects an unknown op (no deletes)", () => {
    expect(visionChangeBody.safeParse({ ...base, op: "delete-goal" }).success).toBe(false);
  });
  it("rejects an empty reason", () => {
    expect(visionChangeBody.safeParse({ ...base, reason: "" }).success).toBe(false);
  });
  it("rejects a missing payload", () => {
    expect(visionChangeBody.safeParse({ op: "upsert-goal", targetId: "g1", reason: "r" }).success).toBe(false);
  });
  it("rejects a non-idPattern targetId", () => {
    expect(visionChangeBody.safeParse({ ...base, targetId: "Bad Id" }).success).toBe(false);
  });
  it("drops unknown keys (plain z.object)", () => {
    const parsed = visionChangeBody.parse({ ...base, status: "rejected", prior: { x: 1 } });
    expect("status" in parsed).toBe(false);
    expect("prior" in parsed).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- schemas`
Expected: FAIL (`visionChangeBody` is not exported).

- [ ] **Step 3: Implement**

In `functions/src/schemas.ts`, add after the `revisionBody` declaration (the spec's schema, verbatim):

```ts
// Vision change: propose-and-apply event. `payload` is re-validated per-op in the
// service with goalBody/scenarioBody so error messages match direct upserts.
export const visionChangeBody = z.object({
  op: z.enum(["upsert-goal", "upsert-scenario"]),
  targetId: id,
  payload: z.record(z.string(), z.unknown()),
  reason: z.string().min(1),
  originLoopId: id.optional(),
});
export type VisionChangeBody = z.infer<typeof visionChangeBody>;
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- schemas`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/schemas.ts functions/test/schemas.test.ts
git commit -m "feat(vision-growth): visionChangeBody schema

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `applyVisionChange` service

**Files:**
- Create: `functions/src/services/visionChanges.ts`
- Test: `functions/test/visionChanges.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

`functions/test/visionChanges.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import "./helpers.js";
import { seedMember } from "./helpers.js";
import { db } from "../src/firestore.js";
import { goalBody, scenarioBody } from "../src/schemas.js";
import { applyVisionChange } from "../src/services/visionChanges.js";
import { upsertScenario } from "../src/services/scenarios.js";

const rubric = { criteria: [{ id: "c1", name: "C", weight: 1, max: 5 }] };

async function seedProject(teamId = "team1", slug = "acme") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
  await seedMember(teamId);
  await db().doc(`teams/${teamId}/projects/${slug}`).set({ title: "Acme", status: "running", visionOwner: "web" });
}

async function changeDocs() {
  return (await db().collection("teams/team1/projects/acme/visionChanges").orderBy("__name__").get()).docs;
}

describe("applyVisionChange", () => {
  it("404s when the project does not exist", async () => {
    await db().doc("teams/team1").set({ name: "T", createdBy: "u1" });
    await seedMember("team1");
    await expect(applyVisionChange("team1", "ghost", { op: "upsert-goal", targetId: "g1", payload: { title: "G" }, reason: "r" }))
      .rejects.toMatchObject({ httpStatus: 404 });
  });

  it("creates a goal exactly like a direct upsert (incl. visionOwner 'loop') and records prior: null", async () => {
    await seedProject();
    const id = await applyVisionChange("team1", "acme",
      { op: "upsert-goal", targetId: "g1", payload: { title: "Ship", order: 1 }, reason: "user asked for shipping" });
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // server-generated ULID
    const g = (await db().doc("teams/team1/projects/acme/goals/g1").get()).data()!;
    expect(g.title).toBe("Ship");
    expect(g.order).toBe(1);
    expect(g.createdAt).toBeDefined();
    expect(g.updatedAt).toBeDefined();
    expect((await db().doc("teams/team1/projects/acme").get()).data()!.visionOwner).toBe("loop");
    const c = (await db().doc(`teams/team1/projects/acme/visionChanges/${id}`).get()).data()!;
    expect(c).toMatchObject({
      op: "upsert-goal", targetId: "g1", payload: { title: "Ship", order: 1 },
      prior: null, reason: "user asked for shipping", status: "applied",
    });
    expect(c.createdAt).toBeDefined();
    expect(c.decidedAt).toBeUndefined();
  });

  it("records the FULL prior doc on update (Timestamps round-trip) and stores originLoopId", async () => {
    await seedProject();
    await upsertScenario("team1", "acme", "s1", { goalId: "g1", title: "S", rubric, threshold: 80 });
    const before = (await db().doc("teams/team1/projects/acme/scenarios/s1").get()).data()!;
    const id = await applyVisionChange("team1", "acme",
      { op: "upsert-scenario", targetId: "s1", payload: { threshold: 90, description: "tightened" },
        reason: "80 proved too lax", originLoopId: "loop-1" });
    const c = (await db().doc(`teams/team1/projects/acme/visionChanges/${id}`).get()).data()!;
    expect(c.prior.title).toBe("S");
    expect(c.prior.threshold).toBe(80);
    expect(c.prior.description).toBeUndefined();
    expect(c.prior.createdAt.toMillis()).toBe(before.createdAt.toMillis()); // Timestamp survives the change doc
    expect(c.originLoopId).toBe("loop-1");
    const s = (await db().doc("teams/team1/projects/acme/scenarios/s1").get()).data()!;
    expect(s.threshold).toBe(90);
    expect(s.description).toBe("tightened");
    expect(s.title).toBe("S"); // merge semantics, same as a direct upsert
  });

  it("payload validation errors match direct-upsert errors (service create-gates + zod)", async () => {
    await seedProject();
    // service-layer create-gate parity (exact messages from goals.ts / scenarios.ts)
    await expect(applyVisionChange("team1", "acme", { op: "upsert-goal", targetId: "g1", payload: { order: 1 }, reason: "r" }))
      .rejects.toMatchObject({ httpStatus: 400, message: "title is required when creating a goal" });
    await expect(applyVisionChange("team1", "acme", { op: "upsert-scenario", targetId: "s1", payload: { title: "S" }, reason: "r" }))
      .rejects.toMatchObject({ httpStatus: 400, message: "goalId, title and rubric are required when creating a scenario" });
    // zod parity — the expected message comes from the SAME schema the direct route uses
    const expectedGoal = goalBody.safeParse({ title: "" }).error!.issues[0].message;
    await expect(applyVisionChange("team1", "acme", { op: "upsert-goal", targetId: "g1", payload: { title: "" }, reason: "r" }))
      .rejects.toMatchObject({ httpStatus: 400, message: expectedGoal });
    const badRubric = { goalId: "g1", title: "S", rubric: { criteria: [] } };
    const expectedScn = scenarioBody.safeParse(badRubric).error!.issues[0].message;
    await expect(applyVisionChange("team1", "acme", { op: "upsert-scenario", targetId: "s1", payload: badRubric, reason: "r" }))
      .rejects.toMatchObject({ httpStatus: 400, message: expectedScn });
  });

  it("a scenario payload referencing a missing goal behaves exactly like the direct upsert", async () => {
    // Neither path checks goal existence (no referential gate in applyScenarioUpsert) — parity by reuse.
    await seedProject();
    const id = await applyVisionChange("team1", "acme",
      { op: "upsert-scenario", targetId: "s1", payload: { goalId: "ghost", title: "S", rubric }, reason: "r" });
    expect((await db().doc("teams/team1/projects/acme/scenarios/s1").get()).data()!.goalId).toBe("ghost");
    expect((await db().doc(`teams/team1/projects/acme/visionChanges/${id}`).get()).exists).toBe(true);
  });

  it("a failed apply writes NO change doc and leaves visionOwner alone (atomic)", async () => {
    await seedProject();
    await expect(applyVisionChange("team1", "acme", { op: "upsert-goal", targetId: "g1", payload: {}, reason: "r" }))
      .rejects.toMatchObject({ httpStatus: 400 });
    expect((await changeDocs()).length).toBe(0);
    expect((await db().doc("teams/team1/projects/acme").get()).data()!.visionOwner).toBe("web");
  });

  it("server-generated change ids ascend (append order == id order)", async () => {
    await seedProject();
    const ids: string[] = [];
    for (const t of ["A", "B", "C"]) {
      ids.push(await applyVisionChange("team1", "acme", { op: "upsert-goal", targetId: "g1", payload: { title: t }, reason: `r-${t}` }));
    }
    expect([...ids].sort()).toEqual(ids); // lexical sort == append order (ULID)
    expect((await changeDocs()).map((d) => d.id)).toEqual(ids);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- visionChanges`
Expected: FAIL (`services/visionChanges.js` does not exist).

- [ ] **Step 3: Implement**

`functions/src/services/visionChanges.ts`:

```ts
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import { ulid } from "../ulid.js";
import { goalBody, scenarioBody } from "../schemas.js";
import type { VisionChangeBody, GoalBody, ScenarioBody } from "../schemas.js";
import { applyGoalUpsert } from "./goals.js";
import { applyScenarioUpsert } from "./scenarios.js";

/**
 * Propose-and-apply a vision change in ONE transaction: capture the target's `prior`
 * state, run the SAME inner upsert helper a direct agent PUT uses (owner "loop"),
 * and record the visionChanges/{ulid} event with status "applied".
 * Returns the server-generated change id.
 */
export async function applyVisionChange(teamId: string, slug: string, body: VisionChangeBody): Promise<string> {
  const isGoal = body.op === "upsert-goal";
  // Re-validate the payload per-op with the SAME zod the direct routes use, so
  // error messages match direct upserts exactly.
  const parsed = (isGoal ? goalBody : scenarioBody).safeParse(body.payload);
  if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);

  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const targetRef = projectRef.collection(isGoal ? "goals" : "scenarios").doc(body.targetId);
  const changeId = ulid();
  await db().runTransaction(async (tx) => {
    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists) throw new AppError(404, "not_found", "project does not exist");
    // Capture `prior` BEFORE dispatching. The upsert helper re-reads the target inside
    // this same transaction — the duplicate read is deliberate (snapshot-consistent,
    // both reads precede all writes). Do NOT refactor the helpers to take a snapshot.
    const targetSnap = await tx.get(targetRef);
    const prior = targetSnap.exists ? targetSnap.data()! : null;
    if (isGoal) await applyGoalUpsert(tx, projectRef, targetRef, parsed.data as GoalBody, "loop");
    else await applyScenarioUpsert(tx, projectRef, targetRef, parsed.data as ScenarioBody, "loop");
    const change: Record<string, unknown> = {
      op: body.op,
      targetId: body.targetId,
      payload: parsed.data, // the body that was applied (zod-stripped)
      prior,                // null on create; Timestamps round-trip via the admin SDK
      reason: body.reason,
      status: "applied",
      createdAt: FieldValue.serverTimestamp(),
    };
    if (body.originLoopId !== undefined) change.originLoopId = body.originLoopId;
    tx.set(projectRef.collection("visionChanges").doc(changeId), change);
  });
  return changeId;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- visionChanges`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/visionChanges.ts functions/test/visionChanges.test.ts
git commit -m "feat(vision-growth): applyVisionChange service (atomic apply + prior snapshot)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `rejectVisionChange` service

**Files:**
- Modify: `functions/src/services/visionChanges.ts`
- Test: `functions/test/visionChanges.test.ts` (extend; add `rejectVisionChange` and `upsertGoal` to the imports)

- [ ] **Step 1: Write the failing tests**

Append to `functions/test/visionChanges.test.ts` (add `rejectVisionChange` to the `visionChanges.js` import and `import { upsertGoal } from "../src/services/goals.js";`):

```ts
describe("rejectVisionChange", () => {
  it("404s when the change does not exist", async () => {
    await seedProject();
    await expect(rejectVisionChange("team1", "acme", "01GHOSTGHOSTGHOSTGHOSTGHST"))
      .rejects.toMatchObject({ httpStatus: 404 });
  });

  it("restores prior WHOLESALE — added fields removed, updatedAt re-stamped, Timestamps round-trip", async () => {
    await seedProject();
    await upsertScenario("team1", "acme", "s1", { goalId: "g1", title: "S", rubric, threshold: 80 });
    const before = (await db().doc("teams/team1/projects/acme/scenarios/s1").get()).data()!;
    const id = await applyVisionChange("team1", "acme",
      { op: "upsert-scenario", targetId: "s1", payload: { threshold: 90, description: "added" }, reason: "r" });
    await rejectVisionChange("team1", "acme", id);
    const s = (await db().doc("teams/team1/projects/acme/scenarios/s1").get()).data()!;
    expect(s.threshold).toBe(80);
    expect("description" in s).toBe(false); // set WITHOUT merge: the added field is gone
    expect(s.title).toBe("S");
    expect(s.goalId).toBe("g1");
    expect(s.createdAt.toMillis()).toBe(before.createdAt.toMillis()); // Timestamp round-trip through prior
    expect(s.updatedAt.toMillis()).toBeGreaterThanOrEqual(before.updatedAt.toMillis()); // re-stamped, not the stale prior value
    const c = (await db().doc(`teams/team1/projects/acme/visionChanges/${id}`).get()).data()!;
    expect(c.status).toBe("rejected");
    expect(c.decidedAt).toBeDefined();
  });

  it("deletes the target when prior is null (the change created it)", async () => {
    await seedProject();
    const id = await applyVisionChange("team1", "acme", { op: "upsert-goal", targetId: "g9", payload: { title: "New goal" }, reason: "r" });
    expect((await db().doc("teams/team1/projects/acme/goals/g9").get()).exists).toBe(true);
    await rejectVisionChange("team1", "acme", id);
    expect((await db().doc("teams/team1/projects/acme/goals/g9").get()).exists).toBe(false);
    expect((await db().doc(`teams/team1/projects/acme/visionChanges/${id}`).get()).data()!.status).toBe("rejected");
  });

  it("re-reject is idempotent: no error, decidedAt unchanged, target NOT restored again", async () => {
    await seedProject();
    await upsertGoal("team1", "acme", "g1", { title: "Old" });
    const id = await applyVisionChange("team1", "acme", { op: "upsert-goal", targetId: "g1", payload: { title: "New" }, reason: "r" });
    await rejectVisionChange("team1", "acme", id);
    const decided1 = (await db().doc(`teams/team1/projects/acme/visionChanges/${id}`).get()).data()!.decidedAt;
    await upsertGoal("team1", "acme", "g1", { title: "Newer" }); // mutate after the reject
    await rejectVisionChange("team1", "acme", id);               // second reject: no-op
    const c = (await db().doc(`teams/team1/projects/acme/visionChanges/${id}`).get()).data()!;
    expect(c.decidedAt.toMillis()).toBe(decided1.toMillis());
    expect((await db().doc("teams/team1/projects/acme/goals/g1").get()).data()!.title).toBe("Newer"); // untouched
  });

  it("does NOT touch visionOwner — the project stays loop-owned after reject", async () => {
    await seedProject();
    const id = await applyVisionChange("team1", "acme", { op: "upsert-goal", targetId: "g1", payload: { title: "G" }, reason: "r" });
    expect((await db().doc("teams/team1/projects/acme").get()).data()!.visionOwner).toBe("loop");
    await rejectVisionChange("team1", "acme", id);
    expect((await db().doc("teams/team1/projects/acme").get()).data()!.visionOwner).toBe("loop");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- visionChanges`
Expected: FAIL (`rejectVisionChange` is not exported).

- [ ] **Step 3: Implement**

Append to `functions/src/services/visionChanges.ts`:

```ts
/**
 * User veto: restore the target to `prior` (null ⇒ delete it) and mark the change
 * rejected. Idempotent when already rejected. Deliberately does NOT touch visionOwner
 * (the apply stamped it "loop"; nobody "helpfully" resets ownership on reject).
 */
export async function rejectVisionChange(teamId: string, slug: string, changeId: string): Promise<void> {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const changeRef = projectRef.collection("visionChanges").doc(changeId);
  await db().runTransaction(async (tx) => {
    const changeSnap = await tx.get(changeRef);
    if (!changeSnap.exists) throw new AppError(404, "not_found", "vision change does not exist");
    const change = changeSnap.data()!;
    if (change.status === "rejected") return; // idempotent
    const isGoal = change.op === "upsert-goal";
    const targetRef = projectRef.collection(isGoal ? "goals" : "scenarios").doc(change.targetId);
    if (change.prior === null) {
      tx.delete(targetRef); // the change created the target — rejecting removes it
    } else {
      // Wholesale restore (set WITHOUT merge) so fields the change ADDED are removed;
      // re-stamp updatedAt so it isn't the stale prior value.
      tx.set(targetRef, { ...change.prior, updatedAt: FieldValue.serverTimestamp() });
    }
    tx.set(changeRef, { status: "rejected", decidedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- visionChanges`
Expected: PASS (all apply + reject tests).

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/visionChanges.ts functions/test/visionChanges.test.ts
git commit -m "feat(vision-growth): rejectVisionChange service (wholesale restore, idempotent)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Routes — agent POST `/vision-changes` + user reject (no `assertWebEditable`)

**Files:**
- Create: `functions/src/routes/visionChanges.ts`
- Modify: `functions/src/app.ts` (import + one project-level mount)
- Modify: `functions/src/routes/userProjects.ts` (reject route)
- Test: extend `functions/test/visionChanges.test.ts` with Supertest API tests

- [ ] **Step 1: Write the failing API tests**

Append to `functions/test/visionChanges.test.ts` (add these imports at the top: `request from "supertest"`, `express from "express"`, `authHeader` from `./helpers.js`, `makeApp` from `../src/app.js`, `makeRequireUser` from `../src/requireUser.js`, `requireMember` from `../src/requireMember.js`, `userProjectsRouter` from `../src/routes/userProjects.js`, `errorHandler` from `../src/errors.js`):

```ts
const app = makeApp();
// User-route harness with a stubbed ID-token verifier (mirrors userProjects.test.ts).
const stubVerify = async (t: string) => { const m = t.match(/^good-(.+)$/); if (!m) throw new Error("x"); return { uid: m[1] }; };
function userApp() {
  const a = express();
  a.use(express.json());
  a.use("/v1/u/teams/:teamId/projects", makeRequireUser(stubVerify), requireMember, userProjectsRouter);
  a.use(errorHandler);
  return a;
}
const utok = (uid: string) => ({ Authorization: `Bearer good-${uid}` });
async function seedUser(uid = "alice", member = true) {
  await db().doc(`users/${uid}`).set({ email: `${uid}@x.com`, isAllowed: true });
  if (member) await db().doc(`teams/team1/members/${uid}`).set({ uid, role: "member" });
}

describe("POST /v1/teams/:teamId/projects/:slug/vision-changes (agent)", () => {
  it("applies and returns { ok: true, id } (event POST shape)", async () => {
    await seedProject();
    const res = await request(app).post("/v1/teams/team1/projects/acme/vision-changes").set(authHeader())
      .send({ op: "upsert-goal", targetId: "g1", payload: { title: "Ship" }, reason: "seed grew" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect((await db().doc("teams/team1/projects/acme/goals/g1").get()).data()!.title).toBe("Ship");
    expect((await db().doc(`teams/team1/projects/acme/visionChanges/${res.body.id}`).get()).data()!.status).toBe("applied");
  });
  it("400s on a missing reason (zod)", async () => {
    await seedProject();
    const res = await request(app).post("/v1/teams/team1/projects/acme/vision-changes").set(authHeader())
      .send({ op: "upsert-goal", targetId: "g1", payload: { title: "Ship" } });
    expect(res.status).toBe(400);
  });
  it("400s on an unknown op", async () => {
    await seedProject();
    const res = await request(app).post("/v1/teams/team1/projects/acme/vision-changes").set(authHeader())
      .send({ op: "delete-goal", targetId: "g1", payload: {}, reason: "r" });
    expect(res.status).toBe(400);
  });
  it("404s when the project does not exist", async () => {
    await db().doc("teams/team1").set({ name: "T", createdBy: "u1" });
    await seedMember("team1");
    const res = await request(app).post("/v1/teams/team1/projects/ghost/vision-changes").set(authHeader())
      .send({ op: "upsert-goal", targetId: "g1", payload: { title: "G" }, reason: "r" });
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/u/.../vision-changes/:changeId/reject (user)", () => {
  it("rejects while the project is loop-owned (no assertWebEditable) and returns { ok: true }", async () => {
    await seedProject();
    await seedUser();
    const id = await applyVisionChange("team1", "acme", { op: "upsert-goal", targetId: "g1", payload: { title: "G" }, reason: "r" });
    // the apply stamped visionOwner "loop" — a normal web vision edit would now 409
    expect((await db().doc("teams/team1/projects/acme").get()).data()!.visionOwner).toBe("loop");
    const res = await request(userApp()).post(`/v1/u/teams/team1/projects/acme/vision-changes/${id}/reject`).set(utok("alice"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await db().doc("teams/team1/projects/acme/goals/g1").get()).exists).toBe(false); // prior null → deleted
    expect((await db().doc("teams/team1/projects/acme").get()).data()!.visionOwner).toBe("loop"); // untouched
  });
  it("is member-only: 403 for a non-member", async () => {
    await seedProject();
    await seedUser("bob", false);
    const id = await applyVisionChange("team1", "acme", { op: "upsert-goal", targetId: "g1", payload: { title: "G" }, reason: "r" });
    const res = await request(userApp()).post(`/v1/u/teams/team1/projects/acme/vision-changes/${id}/reject`).set(utok("bob"));
    expect(res.status).toBe(403);
  });
  it("404s on an unknown changeId", async () => {
    await seedProject();
    await seedUser();
    const res = await request(userApp()).post("/v1/u/teams/team1/projects/acme/vision-changes/01GHOSTGHOSTGHOSTGHOSTGHST/reject").set(utok("alice"));
    expect(res.status).toBe(404);
  });
  it("is idempotent over HTTP: a second reject is also 200", async () => {
    await seedProject();
    await seedUser();
    const id = await applyVisionChange("team1", "acme", { op: "upsert-goal", targetId: "g1", payload: { title: "G" }, reason: "r" });
    expect((await request(userApp()).post(`/v1/u/teams/team1/projects/acme/vision-changes/${id}/reject`).set(utok("alice"))).status).toBe(200);
    expect((await request(userApp()).post(`/v1/u/teams/team1/projects/acme/vision-changes/${id}/reject`).set(utok("alice"))).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- visionChanges`
Expected: FAIL (agent route 404s "unknown route" — no mount; user reject 404s the same way).

- [ ] **Step 3: Implement the agent router**

`functions/src/routes/visionChanges.ts` (mirrors `routes/events.ts`):

```ts
import { Router } from "express";
import { idPattern, visionChangeBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { applyVisionChange } from "../services/visionChanges.js";

export const visionChangesRouter = Router({ mergeParams: true });

visionChangesRouter.post("/", async (req, res, next) => {
  try {
    const { teamId, slug } = req.params as { teamId: string; slug: string };
    if (!idPattern.test(teamId)) throw new AppError(400, "validation", "invalid teamId");
    if (!idPattern.test(slug)) throw new AppError(400, "validation", "invalid project slug");
    const parsed = visionChangeBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const id = await applyVisionChange(teamId, slug, parsed.data);
    res.status(200).json({ ok: true, id });
  } catch (err) { next(err); }
});
```

- [ ] **Step 4: Mount in `app.ts`**

Add the import next to the other route imports:

```ts
import { visionChangesRouter } from "./routes/visionChanges.js";
```

Add ONE project-level mount with the other project-direct mounts (immediately after `teamRouter.use("/:slug/messages", messagesRouter);`). Vision changes are project vision — there is deliberately NO loop-scoped mount:

```ts
  teamRouter.use("/:slug/vision-changes", visionChangesRouter);
```

- [ ] **Step 5: Implement the user reject route**

In `functions/src/routes/userProjects.ts`, add the import:

```ts
import { rejectVisionChange } from "../services/visionChanges.js";
```

and add after the messages POST handler:

```ts
// vision changes: POST /:slug/vision-changes/:changeId/reject
// Deliberately NO assertWebEditable — like the ideas veto and the messages POST,
// rejecting must work while the loop owns the vision.
// changeId is a server ULID (UPPERCASE) — validate non-empty only, never idPattern
// (precedent: messages ack).
userProjectsRouter.post("/:slug/vision-changes/:changeId/reject", async (req, res, next) => {
  try {
    ids(req, ["teamId", "slug"]);
    const { teamId, slug, changeId } = req.params as Record<string, string>;
    if (!changeId || changeId.trim() === "") throw new AppError(400, "validation", "invalid changeId");
    await rejectVisionChange(teamId, slug, changeId);
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd functions && npm run test:run -- visionChanges`
Expected: PASS. Also run `cd functions && npm run test:run -- userProjects` — the existing user-route suite must stay green.

- [ ] **Step 7: Build**

Run: `cd functions && npm run build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add functions/src/routes/visionChanges.ts functions/src/routes/userProjects.ts functions/src/app.ts functions/test/visionChanges.test.ts
git commit -m "feat(vision-growth): agent POST /vision-changes + user reject route (no assertWebEditable)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Rules tests for `visionChanges` (no rules change)

The recursive `match /projects/{slug}/{document=**}` already covers `visionChanges/{id}` — member-read, non-member-deny, client-write-deny. Tests only.

**Files:**
- Modify: `functions/test-rules/rules.test.ts` (extend `seedProjectTree` + the loop-contract `paths` array)

- [ ] **Step 1: Seed a change doc in `seedProjectTree`**

In `functions/test-rules/rules.test.ts`, inside `seedProjectTree`, add after the `messages/m1` line (~250):

```ts
    await fs.doc(`teams/${teamId}/projects/web/visionChanges/01VC`).set({
      op: "upsert-goal", targetId: "g1", payload: { title: "G" }, prior: null, reason: "r", status: "applied",
    });
```

- [ ] **Step 2: Add the path to the loop-contract describe**

In `describe("rules: loop-contract subcollections", …)` add `"visionChanges/01VC"` to its `paths` array (the block already asserts member-read-allow, non-member-read-deny, and client-write-deny for every path — including writes by an owner).

- [ ] **Step 3: Run the rules suite**

Run: `cd functions && npm run test:rules`
Expected: PASS with no `firestore.rules` change.

- [ ] **Step 4: Commit**

```bash
git add functions/test-rules/rules.test.ts
git commit -m "test(rules): cover visionChanges (member-read, client-write-deny)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: CLI `vision propose` + sync the three copies

**Files:**
- Modify: `cli/autoloop.mjs` (one case in the dispatch switch, immediately after the `vision import` case — `vision propose` is a two-word verb, so the dispatch key forms automatically; do NOT touch `ONE_WORD`)
- Modify (generated): `web/public/skill/autoloop.mjs`, `plugins/autoloop/bin/autoloop` (via the sync script)
- Test: `functions/test/cli.unit.test.ts` (extend the `"event + vision verbs (request shapes)"` describe — it already has `initDir`/`cap`/`base` helpers and `writeFileSync`/`join` imports)

- [ ] **Step 1: Write the failing tests**

Add inside the `describe("event + vision verbs (request shapes)", …)` block in `functions/test/cli.unit.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: FAIL (unknown `vision propose` dispatch key → usage error → non-zero exit; the happy-path URL assertions fail).

- [ ] **Step 3: Implement the case**

In `cli/autoloop.mjs`, add immediately after the `case "vision import": { … }` block:

```js
      case "vision propose": {
        oneFlag("op", flags.op); oneFlag("target", flags.target); oneFlag("file", flags.file); oneFlag("reason", flags.reason);
        if (!flags.op || !flags.target || !flags.file || !flags.reason) {
          throw new UsageError("vision propose requires --op <upsert-goal|upsert-scenario> --target <id> --file <payload.json> --reason <text>");
        }
        if (!["upsert-goal", "upsert-scenario"].includes(flags.op)) {
          throw new UsageError(`--op must be upsert-goal|upsert-scenario, got '${flags.op}'`);
        }
        validateId("target", flags.target);
        let payload;
        try { payload = JSON.parse(readFileSync(join(cwd, flags.file), "utf8")); }
        catch (e) { throw new UsageError(`could not read --file '${flags.file}': ${e.message}`); }
        const body = { op: flags.op, targetId: flags.target, payload, reason: flags.reason };
        if (flags["origin-loop"]) { validateId("origin-loop", flags["origin-loop"]); body.originLoopId = flags["origin-loop"]; }
        const cfg = loadConfig(cwd);
        // Project-level on purpose (no loopSeg): vision changes are project vision, never loop-scoped.
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/vision-changes`;
        return report({ method: "POST", url, body },
          { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: PASS.

- [ ] **Step 5: Sync the CLI copies and verify identity**

```bash
bash scripts/sync-autoloop-cli.sh
diff cli/autoloop.mjs plugins/autoloop/bin/autoloop && diff cli/autoloop.mjs web/public/skill/autoloop.mjs && echo IDENTICAL
```
Expected: the `✓ synced …` lines, then `IDENTICAL`.

- [ ] **Step 6: Commit**

```bash
git add cli/autoloop.mjs plugins/autoloop/bin/autoloop web/public/skill/autoloop.mjs functions/test/cli.unit.test.ts
git commit -m "feat(cli): vision propose verb (propose-and-apply vision change)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Web data layer — `VisionChange` type, `useVisionChanges` hook, `rejectVisionChange` API

Plumbing only (the repo has no direct unit tests for `api.ts`/`hooks.ts`); verified by the typecheck/build here and exercised by the component tests in Task 8.

**Files:**
- Modify: `web/src/dashboard/types.ts`
- Modify: `web/src/dashboard/hooks.ts`
- Modify: `web/src/dashboard/api.ts`
- Create: `web/src/dashboard/relativeTime.ts` (shared helper for the new card; the two existing private copies in `MessagesTab.tsx`/`NotificationsBell.tsx` are left alone — refactoring them is out of scope)

- [ ] **Step 1: Add the `VisionChange` type**

In `web/src/dashboard/types.ts` (after the `DocumentRec` line):

```ts
export interface VisionChange {
  id: string; op?: "upsert-goal" | "upsert-scenario"; targetId?: string;
  payload?: Record<string, unknown>; prior?: Record<string, unknown> | null;
  reason?: string; originLoopId?: string; status?: "applied" | "rejected";
  createdAt?: unknown; decidedAt?: unknown;
}
```

- [ ] **Step 2: Add the listener hook**

In `web/src/dashboard/hooks.ts` (add `VisionChange` to the types import; pattern mirrors `useTeamNotifications` — ULID doc ids descend = newest first):

```ts
export function useVisionChanges(teamId: string, slug: string): Result<VisionChange[]> {
  const [data, setData] = useState<VisionChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "teams", teamId, "projects", slug, "visionChanges"), orderBy(documentId(), "desc"));
    return onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as VisionChange[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId, slug]);
  return { data, loading, error };
}
```

- [ ] **Step 3: Add the reject API call**

In `web/src/dashboard/api.ts`:

```ts
export async function rejectVisionChange(teamId: string, slug: string, changeId: string): Promise<void> {
  await ok(await fetch(u(teamId, slug, `/vision-changes/${changeId}/reject`), { method: "POST", headers: await headers() }));
}
```

- [ ] **Step 4: Create the shared `relativeTime` helper**

`web/src/dashboard/relativeTime.ts` (the body is the existing private function from `MessagesTab.tsx`, exported):

```ts
/** "just now" / "Nm ago" / "Nh ago" / "Nd ago" from a Firestore Timestamp or epoch ms. */
export function relativeTime(createdAt: unknown): string {
  const ms =
    createdAt && typeof (createdAt as { toMillis?: () => number }).toMillis === "function"
      ? (createdAt as { toMillis: () => number }).toMillis()
      : typeof createdAt === "number"
        ? createdAt
        : null;
  if (ms === null) return "";
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}
```

- [ ] **Step 5: Typecheck/build + existing web tests stay green**

Run: `cd web && npm run build && npm test`
Expected: build clean; all existing web tests pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/dashboard/types.ts web/src/dashboard/hooks.ts web/src/dashboard/api.ts web/src/dashboard/relativeTime.ts
git commit -m "feat(web): visionChanges data layer (type, listener hook, reject API)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Web UI — `VisionChangeCard` + collapsible Changes feed in the Vision tab

**Files:**
- Create: `web/src/dashboard/components/VisionChangeCard.tsx`
- Create: `web/src/dashboard/components/VisionChangesFeed.tsx`
- Modify: `web/src/dashboard/tabs/VisionTab.tsx` (hook + feed wiring)
- Modify: `web/src/index.css` (small style block)
- Test: `web/src/dashboard/components/visionChanges.test.tsx` (new)

- [ ] **Step 1: Write the failing tests**

`web/src/dashboard/components/visionChanges.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VisionChangesFeed } from "./VisionChangesFeed";
import { VisionChangeCard } from "./VisionChangeCard";
import type { VisionChange } from "../types";

const applied: VisionChange = {
  id: "01B", op: "upsert-scenario", targetId: "login", reason: "found while testing",
  status: "applied", createdAt: Date.now() - 60_000,
};
const rejected: VisionChange = {
  id: "01A", op: "upsert-goal", targetId: "ship", reason: "old idea",
  status: "rejected", createdAt: Date.now() - 120_000, decidedAt: Date.now() - 30_000,
};

afterEach(() => vi.restoreAllMocks());

describe("VisionChangesFeed", () => {
  it("renders nothing when there are no changes", () => {
    const { container } = render(<VisionChangesFeed changes={[]} goals={[]} scenarios={[]} onReject={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("lists changes in the given (newest-first) order with resolved target titles", () => {
    render(<VisionChangesFeed changes={[applied, rejected]}
      goals={[{ id: "ship", title: "Ship it" }]} scenarios={[{ id: "login", title: "Login works" }]}
      onReject={vi.fn()} />);
    expect(screen.getByText(/Changes/)).toBeInTheDocument(); // collapsible summary
    const titles = screen.getAllByText(/Login works|Ship it/).map((n) => n.textContent);
    expect(titles[0]).toBe("Login works"); // newest (the hook supplies desc ULID order)
    expect(titles[1]).toBe("Ship it");
    expect(screen.getByText("Applied")).toBeInTheDocument();
    expect(screen.getByText("Rejected")).toBeInTheDocument();
  });
  it("falls back to the targetId when the target was deleted", () => {
    render(<VisionChangesFeed changes={[applied]} goals={[]} scenarios={[]} onReject={vi.fn()} />);
    expect(screen.getByText("login")).toBeInTheDocument();
  });
});

describe("VisionChangeCard", () => {
  it("Reject asks for confirmation, calls onReject, and flips the chip", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onReject = vi.fn().mockResolvedValue(undefined);
    render(<VisionChangeCard change={applied} targetTitle="Login works" onReject={onReject} />);
    expect(screen.getByText("Applied")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /reject change 01B/i }));
    await waitFor(() => expect(onReject).toHaveBeenCalledWith("01B"));
    expect(screen.getByText("Rejected")).toBeInTheDocument(); // flips without waiting for the snapshot
  });
  it("does nothing when the confirm is cancelled", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const onReject = vi.fn();
    render(<VisionChangeCard change={applied} targetTitle="Login works" onReject={onReject} />);
    fireEvent.click(screen.getByRole("button", { name: /reject change 01B/i }));
    expect(onReject).not.toHaveBeenCalled();
    expect(screen.getByText("Applied")).toBeInTheDocument();
  });
  it("shows the reject error without flipping the chip", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onReject = vi.fn().mockRejectedValue(new Error("HTTP 403"));
    render(<VisionChangeCard change={applied} targetTitle="Login works" onReject={onReject} />);
    fireEvent.click(screen.getByRole("button", { name: /reject change 01B/i }));
    await waitFor(() => expect(screen.getByText(/HTTP 403/)).toBeInTheDocument());
    expect(screen.getByText("Applied")).toBeInTheDocument();
  });
  it("renders a rejected change struck-through (vchange--rejected) with no Reject button", () => {
    render(<VisionChangeCard change={rejected} targetTitle="Ship it" onReject={vi.fn()} />);
    expect(screen.getByText("Ship it").closest(".vchange")).toHaveClass("vchange--rejected");
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reject/i })).toBeNull();
  });
  it("shows the reason and relative times", () => {
    render(<VisionChangeCard change={rejected} targetTitle="Ship it" onReject={vi.fn()} />);
    expect(screen.getByText("old idea")).toBeInTheDocument();
    expect(screen.getByText(/ago|just now/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npm test`
Expected: FAIL (the two components do not exist).

- [ ] **Step 3: Implement `VisionChangeCard`**

`web/src/dashboard/components/VisionChangeCard.tsx`:

```tsx
import { useState } from "react";
import { ErrorNote } from "./ErrorNote";
import { relativeTime } from "../relativeTime";
import type { VisionChange } from "../types";

/** One applied/rejected vision change: op + target, reason, time, status chip, Reject. */
export function VisionChangeCard({ change, targetTitle, onReject }: {
  change: VisionChange; targetTitle: string; onReject: (changeId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [rejectedLocal, setRejectedLocal] = useState(false); // chip flips on API success, before the snapshot lands
  const [error, setError] = useState<string | null>(null);
  const rejected = change.status === "rejected" || rejectedLocal;

  async function handleReject() {
    if (!window.confirm("Reject this change? The target reverts to its prior state.")) return;
    setBusy(true);
    setError(null);
    try { await onReject(change.id); setRejectedLocal(true); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to reject change"); }
    finally { setBusy(false); }
  }

  return (
    <div className={`vchange card${rejected ? " vchange--rejected" : ""}`}>
      <div className="vchange-head">
        <span className="vchange-op dim">{change.op === "upsert-goal" ? "goal" : "scenario"}</span>
        <span className="vchange-title">{targetTitle}</span>
        <span className={`vchange-status vchange-status--${rejected ? "rejected" : "applied"}`}>
          {rejected ? "Rejected" : "Applied"}
        </span>
        {!rejected && (
          <button className="btn btn-sm btn-danger" type="button" disabled={busy}
            aria-label={`reject change ${change.id}`} onClick={() => void handleReject()}>
            {busy ? "Rejecting…" : "Reject"}
          </button>
        )}
      </div>
      {change.reason && <p className="vchange-reason">{change.reason}</p>}
      <span className="vchange-time dim tnum">
        {relativeTime(change.createdAt)}
        {rejected && change.decidedAt != null ? ` · rejected ${relativeTime(change.decidedAt)}` : ""}
      </span>
      {error && <ErrorNote message={error} />}
    </div>
  );
}
```

- [ ] **Step 4: Implement `VisionChangesFeed`**

`web/src/dashboard/components/VisionChangesFeed.tsx` (collapsible via `<details>` — precedent: `ScenarioCard`'s score history):

```tsx
import { VisionChangeCard } from "./VisionChangeCard";
import type { Goal, Scenario, VisionChange } from "../types";

/** Collapsible feed of loop-made vision changes, newest first (hook supplies desc ULID order). */
export function VisionChangesFeed({ changes, goals, scenarios, onReject }: {
  changes: VisionChange[]; goals: Goal[]; scenarios: Scenario[];
  onReject: (changeId: string) => Promise<void>;
}) {
  if (changes.length === 0) return null;
  const titleFor = (c: VisionChange) => {
    const pool: Array<{ id: string; title?: string }> = c.op === "upsert-goal" ? goals : scenarios;
    return pool.find((x) => x.id === c.targetId)?.title ?? c.targetId ?? "";
  };
  return (
    <section className="vchanges">
      <details className="vchanges-details">
        <summary className="proj-section-title">Changes ({changes.length})</summary>
        <div className="vchanges-list">
          {changes.map((c) => (
            <VisionChangeCard key={c.id} change={c} targetTitle={titleFor(c)} onReject={onReject} />
          ))}
        </div>
      </details>
    </section>
  );
}
```

- [ ] **Step 5: Wire into `VisionTab`**

`web/src/dashboard/tabs/VisionTab.tsx` — add the hook + feed (the feed sits under the goals/scenarios section, before documents; every dashboard viewer is a member, so the Reject button needs no extra role gate):

```tsx
import { ScenariosMetBanner } from "../components/ScenariosMetBanner";
import { VisionSection } from "../components/VisionSection";
import { VisionEditableSection } from "../VisionEditableSection";
import { VisionChangesFeed } from "../components/VisionChangesFeed";
import { DocumentsSection } from "../components/DocumentsSection";
import { useVisionChanges } from "../hooks";
import { rejectVisionChange } from "../api";
import { summarize } from "../scenarioState";
import type { Goal, Scenario, Score, TestRun, DocumentRec } from "../types";

export function VisionTab({ teamId, slug, editable, goals, scenarios, scores, testRuns, documents }: {
  teamId: string; slug: string; editable: boolean;
  goals: Goal[]; scenarios: Scenario[]; scores: Score[]; testRuns: TestRun[]; documents: DocumentRec[];
}) {
  const changes = useVisionChanges(teamId, slug);
  const hasScenarios = scenarios.length > 0;
  const { met, total } = summarize(scenarios, scores, testRuns);
  return (
    <>
      {hasScenarios && <ScenariosMetBanner met={met} total={total} />}
      {editable
        ? <VisionEditableSection teamId={teamId} slug={slug} goals={goals} scenarios={scenarios} scores={scores} testRuns={testRuns} documents={documents} />
        : hasScenarios && <VisionSection goals={goals} scenarios={scenarios} scores={scores} testRuns={testRuns} />}
      <VisionChangesFeed changes={changes.data} goals={goals} scenarios={scenarios}
        onReject={(changeId) => rejectVisionChange(teamId, slug, changeId)} />
      <DocumentsSection documents={documents} />
    </>
  );
}
```

- [ ] **Step 6: Styles**

Append to `web/src/index.css` (reuse existing tokens; keep minimal):

```css
/* Vision changes feed (Vision tab) */
.vchanges { margin-top: 24px; }
.vchanges-details > summary { cursor: pointer; }
.vchanges-list { display: grid; gap: 8px; margin-top: 8px; }
.vchange-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.vchange-title { font-weight: 600; }
.vchange-reason { margin: 4px 0 0; }
.vchange--rejected .vchange-title,
.vchange--rejected .vchange-reason { text-decoration: line-through; opacity: 0.6; }
.vchange-status { font-size: 0.8em; padding: 1px 8px; border-radius: 999px; border: 1px solid currentColor; }
.vchange-status--applied { color: #2e7d32; }
.vchange-status--rejected { color: #c62828; }
```

(If the stylesheet already defines chip classes/tokens that fit — e.g. the `.bugstatus--*` pattern — match those colors instead of the hex literals.)

- [ ] **Step 7: Run to verify it passes**

Run: `cd web && npm test && npm run build`
Expected: all web tests PASS (new + existing); build clean.

- [ ] **Step 8: Commit**

```bash
git add web/src/dashboard/components/VisionChangeCard.tsx web/src/dashboard/components/VisionChangesFeed.tsx web/src/dashboard/components/visionChanges.test.tsx web/src/dashboard/tabs/VisionTab.tsx web/src/index.css
git commit -m "feat(web): Changes feed in Vision tab (VisionChangeCard, reject with confirm)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Driver skill — vision growth goes through `vision propose`; plugin bump; skill sync

**Files:**
- Modify: `plugins/autoloop/skills/autoloop/SKILL.md` (Step 2e, Step 3a, Rules)
- Modify: `plugins/autoloop/.claude-plugin/plugin.json` (version `0.10.1` → `0.11.0`)
- Modify (generated): `web/public/skill/autoloop/SKILL.md` (via the sync script)

- [ ] **Step 1: Step 2e addition**

In `plugins/autoloop/skills/autoloop/SKILL.md`, in **“### 2e. Evaluate, revise, drain messages”**, insert a new bullet after the `autoloop revise` bullet:

```markdown
- If this task's work surfaced a **learning that changes the vision** — a new scenario
  discovered while testing, a threshold that proved wrong, a new goal implied by user
  messages — record it as a vision change with the learning as the reason:

  ```bash
  autoloop vision propose --op upsert-scenario --target <id> --file payload.json \
    --reason "<the learning that motivated this change>" --origin-loop <loopId>
  ```

  (`payload.json` holds the goal/scenario body, same shape as a direct PUT.) Then keep
  building immediately — autonomous-with-veto: the change applies now and the user can
  reject it from the dashboard later. If the proposal added a **new scenario**, add a
  task tagged to it to the remaining plan so it gets built and tested this loop.
```

- [ ] **Step 2: Step 3a addition**

In **“### 3a. Scenario verification sweep (do this BEFORE closing)”**, extend the first paragraph's definition of the scenario set — after “the union of `scenarioIds` across all of this loop's tasks”, append:

```markdown
, **including any scenarios this loop added via `autoloop vision propose`** — proposed
scenarios join the plan and are swept like any other
```

- [ ] **Step 3: Rules addition**

In the **“## Rules”** list, add (after the “Honest scoring.” rule):

```markdown
- **Vision growth goes through `vision propose`.** Whenever a loop's learnings warrant
  expanding or tightening the vision (a new scenario discovered while testing, a
  threshold that proved wrong, a new goal implied by user messages), it MUST use
  `autoloop vision propose --reason "<the learning>"` — **never** bare `goal`/`scenario`
  PUT verbs (`goal set` / `scenario set` / direct PUTs remain only for `vision import`
  at setup). This records why + what changed, with one-click user veto. Newly proposed
  scenarios join the plan as tasks tagged to them.
```

- [ ] **Step 4: Bump the plugin version**

In `plugins/autoloop/.claude-plugin/plugin.json`: `"version": "0.10.1"` → `"version": "0.11.0"`.

- [ ] **Step 5: Sync the skill copy and verify**

```bash
bash scripts/sync-autoloop-cli.sh
diff plugins/autoloop/skills/autoloop/SKILL.md web/public/skill/autoloop/SKILL.md && echo IDENTICAL
```
Expected: `IDENTICAL`.

- [ ] **Step 6: Commit**

```bash
git add plugins/autoloop/skills/autoloop/SKILL.md plugins/autoloop/.claude-plugin/plugin.json web/public/skill/autoloop/SKILL.md
git commit -m "feat(skill): vision growth via vision propose (driver rule + steps); bump plugin to 0.11.0

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Full gates

**Files:** none new (verification only; commit anything the gates surface).

- [ ] **Step 1: Functions build + full main suite**

Run: `cd functions && npm run build && npm test`
Expected: build clean; ALL main-suite tests green (incl. the untouched `goals`/`scenarios`/`userProjects`/`events` suites — zero regression from reusing the upsert helpers).

- [ ] **Step 2: Rules suite**

Run: `cd functions && npm run test:rules`
Expected: PASS.

- [ ] **Step 3: Web tests + build**

Run: `cd web && npm test && npm run build`
Expected: PASS; build clean.

- [ ] **Step 4: CLI + skill copies identical**

```bash
diff cli/autoloop.mjs plugins/autoloop/bin/autoloop \
  && diff cli/autoloop.mjs web/public/skill/autoloop.mjs \
  && diff plugins/autoloop/skills/autoloop/SKILL.md web/public/skill/autoloop/SKILL.md \
  && echo ALL-SYNCED
```
Expected: `ALL-SYNCED`.

- [ ] **Step 5: No rules change snuck in**

Run: `git diff --stat main -- firestore.rules`
Expected: empty (the feature ships with NO `firestore.rules` change).

---

## Definition of done

- One agent call (`POST …/vision-changes` / `autoloop vision propose --reason "<learning>"`) applies a goal/scenario upsert exactly like a direct PUT (create-gates, merge semantics, `visionOwner: "loop"` stamp) AND atomically records `visionChanges/{ulid}` with `payload`, `prior` (null on create), `reason`, optional `originLoopId`, `status: "applied"`.
- `POST /v1/u/…/vision-changes/:changeId/reject` (member, NO `assertWebEditable`) restores `prior` wholesale (added fields removed, `updatedAt` re-stamped, Timestamps intact), deletes loop-created targets, is idempotent, marks `rejected` + `decidedAt`, and never touches `visionOwner` — it works mid-loop.
- The Vision tab shows a collapsible Changes feed, newest first, with Applied/Rejected chips, reasons, relative times, a confirm-guarded Reject that calls the API and flips the chip, and struck-through rejected cards.
- The driver skill mandates `vision propose` for mid-loop vision growth (bare goal/scenario PUTs reserved for `vision import`), folds proposed scenarios into the plan and the 3a sweep; plugin bumped to 0.11.0.
- `firestore.rules` unchanged; `visionChanges` member-read/client-write-deny covered by rules tests.
- Three CLI copies and the skill copy identical; functions + rules + web suites green; both builds clean.

## Out of scope (per spec)

- Delete ops, multi-target batches, operational-transform conflict handling (the revert-ordering caveat is documented and accepted).
- A `proposed`-but-not-applied state / hard approval gate (autonomous-with-veto was the user's pick; `status: "proposed"` + an apply endpoint can be added later without schema breakage).
- Notifications on vision change; the "vision grew: +N scenarios" `RollupStrip` count.
