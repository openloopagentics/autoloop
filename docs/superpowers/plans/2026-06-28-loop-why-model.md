# Loop "why" model (SP1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the shared "why" model + an append-only `decision` record so the loop's reasoning is captured and derivable, with no new UI (the graph/vision/timeline render it in SP2/SP3).

**Architecture:** A new loop-scoped `decision` event mirrors the existing append-events (score/test-run/revision/verification) on the backend and CLI. The web gains a pure `whyModel.ts` that merges existing records + decisions into `{ subjects, decisions, evidence, edges }`, with a verification-aware scenario explanation that corrects today's two-condition met-state.

**Tech Stack:** Firebase Cloud Functions (Express + Firestore, TypeScript ESM, Zod, Vitest + emulator), a dependency-free Node CLI (`cli/autoloop.mjs`), and a Vite + React + TS web app (Vitest).

**Spec:** `docs/superpowers/specs/2026-06-28-loop-why-model-design.md`

**Branch:** `loop-why-model` (already created; the spec commit is on it).

**Conventions to honor:**
- Decisions are **append-only** events: server stamps a ULID id + `createdAt`; POST, never PUT/upsert. Mirror `appendRevision`/`revisionsRouter` exactly.
- CLI reporting is **best-effort** (warn + exit 0) unless `--strict`; validate with `UsageError` *before* any network call.
- The CLI verb flag is `--reason`, which maps to the schema/model field **`rationale`** (deliberate: matches `revision`'s `--reason`).
- After editing `cli/autoloop.mjs`, run `bash scripts/sync-autoloop-cli.sh` to update the plugin + curl-installer copies.
- Use @superpowers:test-driven-development for every task: red → green → commit.

---

## File Structure

**Backend (functions/):**
- Modify `src/schemas.ts` — add `decisionBody` + `DecisionBody` type.
- Modify `src/services/events.ts` — add `appendDecision`.
- Modify `src/routes/events.ts` — add `decisionsRouter`.
- Modify `src/app.ts` — import + mount `decisionsRouter` project-direct and loop-scoped.
- Create `test/decisions.test.ts` — route + service emulator tests.

**CLI:**
- Modify `cli/autoloop.mjs` — add the `decision add` verb.
- Modify `functions/test/cli.unit.test.ts` — add `decision add` unit tests.
- Modify `plugins/autoloop/skills/autoloop/SKILL.md` — driver emit guidance.

**Web (web/src/dashboard/):**
- Modify `types.ts` — add `Decision` interface.
- Modify `hooks.ts` — add `useDecisions` listener hook.
- Create `whyModel.ts` — the model types + `explainScenario` + `buildWhyModel`.
- Create `whyModel.test.ts` — pure-function tests (the heart of SP1).

---

## Task 1: `decisionBody` schema

**Files:**
- Modify: `functions/src/schemas.ts`
- Test: `functions/test/decisions.test.ts` (new — schema section)

- [ ] **Step 1: Write the failing test**

Create `functions/test/decisions.test.ts` with a pure schema section (no emulator needed yet):

```typescript
import { describe, it, expect } from "vitest";
import { decisionBody } from "../src/schemas.js";

describe("decisionBody", () => {
  it("accepts a minimal valid decision", () => {
    const r = decisionBody.safeParse({ kind: "goal-pick", summary: "checkout reliability", rationale: "top accepted idea" });
    expect(r.success).toBe(true);
  });
  it("accepts refs + alternatives", () => {
    const r = decisionBody.safeParse({
      kind: "stuck", summary: "retry flaky", rationale: "fixed-delay still fails",
      alternatives: ["tried fixed delay"], refs: { scenarioIds: ["s1"], taskIds: ["t1"], commitShas: ["abc123"] },
    });
    expect(r.success).toBe(true);
  });
  it("rejects an unknown kind", () => {
    expect(decisionBody.safeParse({ kind: "whatever", summary: "x", rationale: "y" }).success).toBe(false);
  });
  it("rejects an empty summary and an oversized rationale", () => {
    expect(decisionBody.safeParse({ kind: "approach", summary: "", rationale: "y" }).success).toBe(false);
    expect(decisionBody.safeParse({ kind: "approach", summary: "x", rationale: "y".repeat(4097) }).success).toBe(false);
  });
  it("rejects a ref id with a bad pattern", () => {
    expect(decisionBody.safeParse({ kind: "approach", summary: "x", rationale: "y", refs: { scenarioIds: ["Bad Id"] } }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- decisions`
Expected: FAIL — `decisionBody` is not exported.

- [ ] **Step 3: Implement the schema**

In `functions/src/schemas.ts`, after `revisionBody` (near line 152), add:

```typescript
// Decision: append-only reasoning event for the three "why" moments the loop can't
// otherwise record (goal choice, task approach, dead-ends). Plan changes live in
// revisionBody; vision changes in visionChangeBody. Server stamps id (ULID) + createdAt.
export const decisionBody = z.object({
  kind: z.enum(["goal-pick", "approach", "stuck"]),
  summary: z.string().min(1).max(200),
  rationale: z.string().min(1).max(4096),
  alternatives: z.array(z.string().min(1).max(500)).max(10).optional(),
  refs: z
    .object({
      scenarioIds: z.array(id).optional(),
      taskIds: z.array(id).optional(),
      commitShas: z.array(id).optional(),
    })
    .optional(),
  by: z.string().max(200).optional(),
});
export type DecisionBody = z.infer<typeof decisionBody>;
```

(`id` is the existing id-pattern helper already used by `revisionBody`.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- decisions`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/src/schemas.ts functions/test/decisions.test.ts
git commit -m "feat(functions): add decisionBody schema"
```

---

## Task 2: `appendDecision` service

**Files:**
- Modify: `functions/src/services/events.ts`
- Test: `functions/test/decisions.test.ts` (add service section)

- [ ] **Step 1: Write the failing test**

Append to `functions/test/decisions.test.ts` (emulator-backed). Mirror how other event tests resolve the base path; this writes to a loop-scoped collection and asserts the stored doc:

```typescript
import "./helpers.js";
import { db } from "../src/firestore.js";
import { appendDecision } from "../src/services/events.js";

describe("appendDecision (service)", () => {
  it("stamps a ULID id + createdAt and writes under the loop", async () => {
    await db().doc("teams/t1/projects/acme").set({ title: "Acme", status: "running" });
    await db().doc("teams/t1/projects/acme/loops/L1").set({ name: "loop", status: "running" });
    const id = await appendDecision("t1", "acme", { kind: "goal-pick", summary: "s", rationale: "r", refs: { scenarioIds: ["s1"] } }, "L1");
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    const doc = (await db().doc(`teams/t1/projects/acme/loops/L1/decisions/${id}`).get()).data()!;
    expect(doc.kind).toBe("goal-pick");
    expect(doc.by).toBe("driver");           // default applied
    expect(doc.refs.scenarioIds).toEqual(["s1"]);
    expect(doc.createdAt).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm test -- decisions`  *(self-launches the Firestore emulator; needs Java)*
Expected: FAIL — `appendDecision` is not exported.

- [ ] **Step 3: Implement the service**

In `functions/src/services/events.ts`: add `DecisionBody` to the type import on line 4, then append:

```typescript
export async function appendDecision(teamId: string, slug: string, body: DecisionBody, loopId?: string): Promise<string> {
  const { baseRef } = await resolveBase(teamId, slug, loopId);
  const id = ulid();
  // No transaction needed: server-generated id (no write-write conflict), no derived fields.
  const data: Record<string, unknown> = {
    kind: body.kind,
    summary: body.summary,
    rationale: body.rationale,
    by: body.by ?? "driver",
    createdAt: FieldValue.serverTimestamp(),
  };
  if (body.alternatives !== undefined) data.alternatives = body.alternatives;
  if (body.refs !== undefined) data.refs = body.refs;
  await baseRef.collection("decisions").doc(id).set(data);
  return id;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm test -- decisions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/events.ts functions/test/decisions.test.ts
git commit -m "feat(functions): appendDecision service (loop-scoped append event)"
```

---

## Task 3: `decisionsRouter` + mounting

**Files:**
- Modify: `functions/src/routes/events.ts`
- Modify: `functions/src/app.ts`
- Test: `functions/test/decisions.test.ts` (add route section)

- [ ] **Step 1: Write the failing test**

Append a route section. Reuse the existing test harness (`seedMember`, `authHeader`, `makeApp`) the way `test/visionChanges.test.ts` does:

```typescript
import request from "supertest";
import { seedMember, authHeader } from "./helpers.js";
import { makeApp } from "../src/app.js";

describe("POST .../loops/:loopId/decisions (agent)", () => {
  const app = makeApp();
  async function seed() {
    await db().doc("teams/t1").set({ name: "T", createdBy: "u1" });
    await seedMember("t1");
    await db().doc("teams/t1/projects/acme").set({ title: "Acme", status: "running" });
    await db().doc("teams/t1/projects/acme/loops/L1").set({ name: "loop", status: "running" });
  }
  it("appends and returns { ok, id }", async () => {
    await seed();
    const res = await request(app).post("/v1/teams/t1/projects/acme/loops/L1/decisions").set(authHeader())
      .send({ kind: "goal-pick", summary: "s", rationale: "r" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
  it("rejects a bad kind with 400", async () => {
    await seed();
    const res = await request(app).post("/v1/teams/t1/projects/acme/loops/L1/decisions").set(authHeader())
      .send({ kind: "nope", summary: "s", rationale: "r" });
    expect(res.status).toBe(400);
  });
});
```

(Check `test/visionChanges.test.ts` for the exact `app`/`makeApp` usage in this repo and match it.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm test -- decisions`
Expected: FAIL — route 404s (not mounted).

- [ ] **Step 3: Implement the router + mount**

In `functions/src/routes/events.ts`: add `decisionBody` to the schema import (line 2) and `appendDecision` to the service import (line 4), then append (mirroring `revisionsRouter`):

```typescript
export const decisionsRouter = Router({ mergeParams: true });
decisionsRouter.post("/", async (req, res, next) => {
  try {
    const { teamId, slug, loopId } = req.params as { teamId: string; slug: string; loopId?: string };
    if (!idPattern.test(teamId)) throw new AppError(400, "validation", "invalid teamId");
    if (!idPattern.test(slug)) throw new AppError(400, "validation", "invalid project slug");
    if (loopId !== undefined && !idPattern.test(loopId)) throw new AppError(400, "validation", "invalid loopId");
    const parsed = decisionBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const id = await appendDecision(teamId, slug, parsed.data, loopId);
    res.status(200).json({ ok: true, id });
  } catch (err) { next(err); }
});
```

In `functions/src/app.ts`: add `decisionsRouter` to the `events.js` import (line 19), then mount in both blocks:
- project-direct, after line 55: `teamRouter.use("/:slug/decisions", decisionsRouter);`
- loop-scoped, after line 69: `teamRouter.use("/:slug/loops/:loopId/decisions", decisionsRouter);`

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm test -- decisions`
Expected: PASS. Then run the full suite once: `npm test` (expect green, no regressions) and `npm run build` (clean).

- [ ] **Step 5: Commit**

```bash
git add functions/src/routes/events.ts functions/src/app.ts functions/test/decisions.test.ts
git commit -m "feat(functions): mount decisions route (project-direct + loop-scoped)"
```

---

## Task 4: CLI `decision add` verb

**Files:**
- Modify: `cli/autoloop.mjs`
- Test: `functions/test/cli.unit.test.ts`
- Then: `bash scripts/sync-autoloop-cli.sh`

- [ ] **Step 1: Write the failing test**

Add to `functions/test/cli.unit.test.ts` (mirror the existing `run([...])` + injected `fetchImpl` style; the `bug add` tests are a good template). Use a config with `currentLoopId` set so the URL is loop-scoped:

```typescript
describe("decision add", () => {
  function initDir() {
    const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentLoopId: "L1", loops: {}, phases: {}, tasks: {} });
    return dir;
  }
  it("POSTs a loop-scoped decision with mapped fields", async () => {
    const dir = initDir(); let cap: any;
    const code = await run(["decision", "add", "--kind", "goal-pick", "--summary", "s", "--reason", "r", "--scenario", "s1", "--scenario", "s2", "--alt", "tried X"],
      { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {},
        fetchImpl: async (url: string, init: any) => { cap = { url, method: init.method, body: JSON.parse(init.body) }; return { ok: true, status: 200, json: async () => ({ ok: true, id: "01ABC" }) }; } });
    expect(code).toBe(0);
    expect(cap.method).toBe("POST");   // append, server-generated id
    expect(cap.url).toBe("http://api/v1/teams/acme/projects/web/loops/L1/decisions");
    expect(cap.body).toMatchObject({ kind: "goal-pick", summary: "s", rationale: "r", refs: { scenarioIds: ["s1", "s2"] }, alternatives: ["tried X"] });
  });
  it("rejects a bad --kind before any network call", async () => {
    const dir = initDir();
    const code = await run(["decision", "add", "--kind", "bogus", "--summary", "s", "--reason", "r"],
      { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).toBe(1);
  });
  it("requires --summary and --reason", async () => {
    const dir = initDir();
    const code = await run(["decision", "add", "--kind", "stuck"],
      { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: FAIL — unknown verb `decision add` (exit 1 with an "unknown command" message, or the POST assertion fails).

- [ ] **Step 3: Implement the verb**

In `cli/autoloop.mjs`, add a `case "decision add":` to the `run()` dispatch (mirror `bug add` at ~line 968; place it near the other loop-scoped event verbs):

```javascript
case "decision add": {
  const kind = flags.kind;
  if (!["goal-pick", "approach", "stuck"].includes(kind)) throw new UsageError(`--kind must be goal-pick|approach|stuck, got '${kind}'`);
  if (!flags.summary) throw new UsageError("decision add requires --summary <s>");
  if (!flags.reason) throw new UsageError("decision add requires --reason <r>");
  const body = { kind, summary: oneFlag("summary", flags.summary), rationale: oneFlag("reason", flags.reason) };
  const alts = asArray(flags.alt); if (alts.length) body.alternatives = alts;
  const refs = {};
  const scen = asArray(flags.scenario); if (scen.length) { scen.forEach((s) => validateId("scenario", s)); refs.scenarioIds = scen; }
  const tsk = asArray(flags.task); if (tsk.length) { tsk.forEach((t) => validateId("task", t)); refs.taskIds = tsk; }
  const com = asArray(flags.commit); if (com.length) { com.forEach((c) => validateId("commit", c)); refs.commitShas = com; }
  if (Object.keys(refs).length) body.refs = refs;
  const cfg = loadConfig(cwd);
  const url = `${resolveApiUrl(cfg, env, oneFlag("url", flags.url))}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}${loopSeg(cfg)}/decisions`;
  return report({ method: "POST", url, body }, { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
}
```

Also add a one-line usage entry to the CLI help/usage text near the other `… add` verbs (find the help block and match its format).

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: PASS.

- [ ] **Step 5: Sync the CLI copies + commit**

```bash
bash scripts/sync-autoloop-cli.sh
git add cli/autoloop.mjs web/public/skill/autoloop.mjs plugins/autoloop/bin/autoloop functions/test/cli.unit.test.ts
git commit -m "feat(cli): add 'decision add' verb (best-effort, loop-scoped POST)"
```

---

## Task 5: Driver emit guidance (SKILL.md)

**Files:**
- Modify: `plugins/autoloop/skills/autoloop/SKILL.md`

No automated test (documentation). Keep it short — signal, not a log.

- [ ] **Step 1: Add guidance**

Add a short subsection telling the driver to emit a decision at three points, with the exact command. Match the surrounding SKILL.md voice:

```markdown
### Recording decisions (the "why")

Emit a decision at these moments so the dashboard can explain the loop's reasoning.
Best-effort — never block the loop. One decision per moment; this is signal, not a log.

- **Loop start** — after resume/setup, state the loop's thesis:
  `autoloop decision add --kind goal-pick --summary "<one line>" --reason "<why this goal now>"`
- **Non-obvious task approach** — when the chosen path isn't the obvious one (skip routine tasks):
  `autoloop decision add --kind approach --summary "<choice>" --reason "<why>" --task <taskId> [--alt "<rejected option>"]`
- **Stuck** — when a scenario won't converge after a revision, or the loop blocks/pauses:
  `autoloop decision add --kind stuck --summary "<what's blocking>" --reason "<what was tried, what's next>" --scenario <id>`
```

- [ ] **Step 2: Sync (SKILL.md is bundled) + commit**

```bash
bash scripts/sync-autoloop-cli.sh   # re-copies bundled skills to the curl installer
git add plugins/autoloop/skills/autoloop/SKILL.md web/public/skill/autoloop/SKILL.md
git commit -m "docs(skill): tell the driver when to emit decisions"
```

---

## Task 6: web `Decision` type + `useDecisions` hook

**Files:**
- Modify: `web/src/dashboard/types.ts`
- Modify: `web/src/dashboard/hooks.ts`

- [ ] **Step 1: Add the type**

In `web/src/dashboard/types.ts`, alongside `Revision`/`VisionChange`:

```typescript
export interface Decision {
  id: string;
  kind?: "goal-pick" | "approach" | "stuck";
  summary?: string;
  rationale?: string;
  alternatives?: string[];
  refs?: { scenarioIds?: string[]; taskIds?: string[]; commitShas?: string[] };
  by?: string;
  createdAt?: unknown;
}
```

- [ ] **Step 2: Add the hook**

In `web/src/dashboard/hooks.ts`, add `Decision` to the `types` import, then mirror `useRevisions` exactly:

```typescript
export function useDecisions(teamId: string, slug: string, loopId?: string): Result<Decision[]> {
  return useFirestoreQuery<Decision[]>(
    () => query(collection(db, ...basePath(teamId, slug, loopId), "decisions"), orderBy(documentId())),
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Decision[],
    [],
    [teamId, slug, loopId],
  );
}
```

- [ ] **Step 3: Verify build**

Run: `cd web && npm run build`
Expected: clean type-check (no test for a thin listener hook — covered indirectly; the hook factory `useFirestoreQuery` is already tested).

- [ ] **Step 4: Commit**

```bash
git add web/src/dashboard/types.ts web/src/dashboard/hooks.ts
git commit -m "feat(web): Decision type + useDecisions listener hook"
```

---

## Task 7: `explainScenario` — verification-aware scenario explanation

**Files:**
- Create: `web/src/dashboard/whyModel.ts`
- Test: `web/src/dashboard/whyModel.test.ts`

This is the SP1 behavior change: met/unmet becomes the canonical **3-condition** rule
(score ≥ threshold, test failed === 0, **not refuted**), with per-condition reasons.

- [ ] **Step 1: Write the failing test**

Create `web/src/dashboard/whyModel.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { explainScenario } from "./whyModel";
import type { Scenario, Score, TestRun, Verification } from "./types";

const scn: Scenario = { id: "s1", threshold: 80 };
const score = (id: string, composite: number): Score => ({ id, scenarioId: "s1", composite });
const test = (id: string, failed: number): TestRun => ({ id, scenarioId: "s1", failed });
const ver = (id: string, verdict: "confirmed" | "refuted"): Verification => ({ id, scenarioId: "s1", verdict });

describe("explainScenario", () => {
  it("met when score ≥ threshold, no test failures, not refuted", () => {
    const e = explainScenario(scn, [score("A", 90)], [test("A", 0)], []);
    expect(e.state).toBe("met");
    expect(e.reasons.every((r) => r.ok)).toBe(true);
  });
  it("unmet with a score reason when composite < threshold", () => {
    const e = explainScenario(scn, [score("A", 72)], [test("A", 0)], []);
    expect(e.state).toBe("unmet");
    expect(e.reasons[0]).toMatchObject({ kind: "score", ok: false });
    expect(e.reasons[0].text).toContain("72");
    expect(e.reasons[0].text).toContain("80");
  });
  it("unmet when latest test has failures", () => {
    const e = explainScenario(scn, [score("A", 90)], [test("A", 2)], []);
    expect(e.state).toBe("unmet");
    expect(e.reasons.find((r) => r.kind === "test")).toMatchObject({ ok: false });
  });
  it("unmet when refuted, even with a high score and passing tests", () => {
    const e = explainScenario(scn, [score("A", 95)], [test("A", 0)], [ver("A", "refuted")]);
    expect(e.state).toBe("unmet");
    expect(e.reasons.find((r) => r.kind === "verification")).toMatchObject({ ok: false });
  });
  it("met is unaffected by a confirmed verification", () => {
    expect(explainScenario(scn, [score("A", 90)], [test("A", 0)], [ver("A", "confirmed")]).state).toBe("met");
  });
  it("unmet with a 'missing' reason when there is no test run", () => {
    const e = explainScenario(scn, [score("A", 90)], [], []);
    expect(e.state).toBe("unmet");
    expect(e.reasons.some((r) => r.kind === "missing")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npm test -- whyModel`
Expected: FAIL — `whyModel.ts` does not exist.

- [ ] **Step 3: Implement `explainScenario`**

Create `web/src/dashboard/whyModel.ts`:

```typescript
import { latestById, DEFAULT_THRESHOLD } from "./scenarioState";
import type { Scenario, Score, TestRun, Verification } from "./types";

export type SubjectState = "met" | "unmet" | "neutral" | "active" | "bugged";

export interface ExplanationReason {
  kind: "score" | "test" | "verification" | "missing";
  ok: boolean;
  text: string;
  evidenceId?: string;
}
export interface Explanation {
  state: SubjectState;
  reasons: ExplanationReason[];
}

/**
 * Why a scenario is met/unmet, per the CANONICAL 3-condition rule (docs/concepts.md):
 * score ≥ threshold AND latest test failed === 0 AND latest verification not refuted.
 * This is verification-aware on purpose — it corrects the legacy 2-condition
 * deriveScenarioState (SP2 consolidates onto this).
 */
export function explainScenario(
  scenario: Scenario,
  scores: Score[],
  testRuns: TestRun[],
  verifications: Verification[],
): Explanation {
  const latestScore = latestById(scores.filter((s) => s.scenarioId === scenario.id));
  const latestTest = latestById(testRuns.filter((r) => r.scenarioId === scenario.id));
  const latestVer = latestById(verifications.filter((v) => v.scenarioId === scenario.id));
  const threshold = scenario.threshold ?? DEFAULT_THRESHOLD;
  const reasons: ExplanationReason[] = [];

  if (latestScore?.composite == null) {
    reasons.push({ kind: "missing", ok: false, text: "no score yet" });
  } else {
    const ok = latestScore.composite >= threshold;
    const crit = latestScore.criteria
      ? ` (${Object.entries(latestScore.criteria).map(([k, v]) => `${k} ${v}`).join(", ")})`
      : "";
    const note = latestScore.note ? ` · note: ${latestScore.note}` : "";
    reasons.push({ kind: "score", ok, text: `score ${latestScore.composite} ${ok ? "≥" : "<"} threshold ${threshold}${crit}${note}`, evidenceId: latestScore.id });
  }

  if (!latestTest) {
    reasons.push({ kind: "missing", ok: false, text: "no test run yet" });
  } else {
    const failed = latestTest.failed ?? 0;
    const ok = failed === 0;
    const issues = latestTest.issues?.length ? ` (${latestTest.issues.join("; ")})` : "";
    reasons.push({ kind: "test", ok, text: ok ? "all tests passing" : `${failed} test(s) failing${issues}`, evidenceId: latestTest.id });
  }

  if (latestVer?.verdict === "refuted") {
    reasons.push({ kind: "verification", ok: false, text: latestVer.summary ? `refuted: ${latestVer.summary}` : "refuted by verification", evidenceId: latestVer.id });
  } else if (latestVer?.verdict === "confirmed") {
    reasons.push({ kind: "verification", ok: true, text: "verification confirmed", evidenceId: latestVer.id });
  }

  const state: SubjectState = reasons.every((r) => r.ok) ? "met" : "unmet";
  reasons.sort((a, b) => Number(a.ok) - Number(b.ok)); // failing reasons first
  return { state, reasons };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npm test -- whyModel`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard/whyModel.ts web/src/dashboard/whyModel.test.ts
git commit -m "feat(web): explainScenario — canonical verification-aware met/unmet"
```

---

## Task 8: decision adapters — existing records → unified decisions

**Files:**
- Modify: `web/src/dashboard/whyModel.ts`
- Test: `web/src/dashboard/whyModel.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```typescript
import { toDecisions } from "./whyModel";
import type { Revision, VisionChange, Decision, Idea } from "./types";

describe("toDecisions", () => {
  const loopId = "L1";
  it("maps a revision to a plan-change with refs from trigger + changes", () => {
    const rev: Revision = { id: "R1", trigger: { scenarioId: "s1", reason: "rough UX" }, changes: [{ op: "add", taskId: "t9" }] };
    const out = toDecisions({ loopId, decisions: [], revisions: [rev], visionChanges: [], ideas: [] });
    const d = out.find((x) => x.source === "revision")!;
    expect(d.kind).toBe("plan-change");
    expect(d.rationale).toBe("rough UX");
    expect(d.refs.scenarioIds).toContain("s1");
    expect(d.refs.taskIds).toContain("t9");
  });
  it("maps a visionChange to a vision-change", () => {
    const vc: VisionChange = { id: "V1", op: "upsert-scenario", targetId: "s2", reason: "missing edge case" };
    const out = toDecisions({ loopId, decisions: [], revisions: [], visionChanges: [vc], ideas: [] });
    expect(out.find((x) => x.source === "visionChange")).toMatchObject({ kind: "vision-change", rationale: "missing edge case" });
  });
  it("passes through a real decision record", () => {
    const dec: Decision = { id: "D1", kind: "goal-pick", summary: "s", rationale: "r" };
    expect(toDecisions({ loopId, decisions: [dec], revisions: [], visionChanges: [], ideas: [] }).find((x) => x.source === "decision")).toMatchObject({ kind: "goal-pick" });
  });
  it("synthesizes a goal-pick from the seeding idea only when no goal-pick decision exists", () => {
    const idea: Idea = { id: "I1", title: "Checkout", rationale: "top theme", status: "accepted", builtInLoopId: "L1" };
    const synth = toDecisions({ loopId, decisions: [], revisions: [], visionChanges: [], ideas: [idea] });
    expect(synth.find((x) => x.source === "synthesized")).toMatchObject({ kind: "goal-pick" });
    const withReal = toDecisions({ loopId, decisions: [{ id: "D1", kind: "goal-pick", summary: "s", rationale: "r" }], revisions: [], visionChanges: [], ideas: [idea] });
    expect(withReal.some((x) => x.source === "synthesized")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npm test -- whyModel`
Expected: FAIL — `toDecisions` not exported.

- [ ] **Step 3: Implement the adapters**

Append to `web/src/dashboard/whyModel.ts`:

```typescript
import type { Revision, VisionChange, Decision, Idea } from "./types";

export type DecisionKind = "goal-pick" | "approach" | "stuck" | "plan-change" | "vision-change";

export interface WhyDecision {
  id: string;
  kind: DecisionKind;
  loopId?: string;
  summary: string;
  rationale: string;
  alternatives?: string[];
  refs: { scenarioIds: string[]; taskIds: string[]; commitShas: string[] };
  source: "decision" | "revision" | "visionChange" | "synthesized";
}

interface DecisionInputs {
  loopId?: string;
  decisions: Decision[];
  revisions: Revision[];
  visionChanges: VisionChange[];
  ideas: Idea[];
}

const emptyRefs = () => ({ scenarioIds: [] as string[], taskIds: [] as string[], commitShas: [] as string[] });

export function toDecisions(inp: DecisionInputs): WhyDecision[] {
  const out: WhyDecision[] = [];

  for (const d of inp.decisions) {
    out.push({
      id: d.id, kind: (d.kind ?? "approach") as DecisionKind, loopId: inp.loopId,
      summary: d.summary ?? "", rationale: d.rationale ?? "", alternatives: d.alternatives,
      refs: { scenarioIds: d.refs?.scenarioIds ?? [], taskIds: d.refs?.taskIds ?? [], commitShas: d.refs?.commitShas ?? [] },
      source: "decision",
    });
  }

  for (const r of inp.revisions) {
    const refs = emptyRefs();
    if (r.trigger?.scenarioId) refs.scenarioIds.push(r.trigger.scenarioId);
    for (const c of r.changes ?? []) if (c.taskId) refs.taskIds.push(c.taskId);
    out.push({
      id: r.id, kind: "plan-change", loopId: inp.loopId,
      summary: (r.changes ?? []).map((c) => `${c.op} ${c.taskId}`).join(", ") || "plan change",
      rationale: r.trigger?.reason ?? "", refs, source: "revision",
    });
  }

  for (const v of inp.visionChanges) {
    out.push({
      id: v.id, kind: "vision-change", loopId: v.originLoopId ?? inp.loopId,
      summary: `${v.op ?? "change"} ${v.targetId ?? ""}`.trim(), rationale: v.reason ?? "",
      refs: { ...emptyRefs(), scenarioIds: v.targetId ? [v.targetId] : [] }, source: "visionChange",
    });
  }

  // Synthesize a goal-pick from the idea that seeded THIS loop, only if the driver
  // didn't emit one. source:"synthesized" lets a surface render it faintly.
  const hasGoalPick = out.some((d) => d.kind === "goal-pick");
  if (!hasGoalPick) {
    const seed = inp.ideas.find((i) => i.builtInLoopId === inp.loopId && i.status !== "rejected");
    if (seed) {
      out.push({
        id: `synth:${seed.id}`, kind: "goal-pick", loopId: inp.loopId,
        summary: seed.title ?? "goal", rationale: seed.rationale ?? "", refs: emptyRefs(), source: "synthesized",
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npm test -- whyModel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard/whyModel.ts web/src/dashboard/whyModel.test.ts
git commit -m "feat(web): toDecisions — unify decisions/revisions/visionChanges/seed idea"
```

---

## Task 9: `buildWhyModel` — assemble subjects + evidence + edges

**Files:**
- Modify: `web/src/dashboard/whyModel.ts`
- Test: `web/src/dashboard/whyModel.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```typescript
import { buildWhyModel } from "./whyModel";
import type { Goal, Task, Bug } from "./types";

describe("buildWhyModel", () => {
  const base = {
    loopId: "L1",
    goals: [{ id: "g1", title: "Resilient checkout" }] as Goal[],
    scenarios: [{ id: "s1", goalId: "g1", title: "Retry", threshold: 80 }] as Scenario[],
    tasks: [{ id: "t1", title: "Backoff", scenarioIds: ["s1"], loopId: "L1" }] as Task[],
    bugs: [] as Bug[],
    scores: [{ id: "A", scenarioId: "s1", composite: 72 }] as Score[],
    testRuns: [{ id: "A", scenarioId: "s1", failed: 0 }] as TestRun[],
    verifications: [] as Verification[],
    revisions: [{ id: "R1", trigger: { scenarioId: "s1", reason: "low" }, changes: [{ op: "add", taskId: "t1" }] }] as Revision[],
    visionChanges: [] as VisionChange[],
    decisions: [] as Decision[],
    ideas: [] as Idea[],
  };
  it("builds subjects with namespaced ids and a scenario explanation", () => {
    const m = buildWhyModel(base);
    const s = m.subjects.find((x) => x.id === "scenario:s1")!;
    expect(s.kind).toBe("scenario");
    expect(s.explanation?.state).toBe("unmet");      // 72 < 80
  });
  it("emits structure edges goal→scenario→task", () => {
    const m = buildWhyModel(base);
    expect(m.edges).toContainEqual({ type: "structure", from: "goal:g1", to: "scenario:s1" });
    expect(m.edges).toContainEqual({ type: "structure", from: "scenario:s1", to: "task:t1" });
  });
  it("emits an affects edge from a decision to its referenced subjects", () => {
    const m = buildWhyModel(base);
    expect(m.edges.some((e) => e.type === "affects" && e.to === "scenario:s1")).toBe(true);
  });
  it("drops dangling refs (no edge to a non-existent subject)", () => {
    const m = buildWhyModel({ ...base, decisions: [{ id: "D1", kind: "approach", summary: "x", rationale: "y", refs: { taskIds: ["ghost"] } }] });
    expect(m.edges.some((e) => e.to === "task:ghost")).toBe(false);
  });
  it("turns scores/testRuns into evidence rows linked to the scenario", () => {
    const m = buildWhyModel(base);
    expect(m.evidence.some((e) => e.kind === "score" && e.subjectId === "scenario:s1" && e.relation === "supports")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npm test -- whyModel`
Expected: FAIL — `buildWhyModel` not exported.

- [ ] **Step 3: Implement `buildWhyModel`**

Append to `web/src/dashboard/whyModel.ts`:

```typescript
import type { Goal, Task, Bug } from "./types";

export type SubjectKind = "loop" | "goal" | "scenario" | "task" | "bug";

export interface WhySubject {
  id: string;
  kind: SubjectKind;
  label: string;
  loopId?: string;
  explanation?: Explanation;
}
export interface WhyEvidence {
  id: string;
  kind: "score" | "test-run" | "verification" | "commit";
  subjectId: string;
  relation: "supports" | "refutes";
  detail: Record<string, unknown>;
}
export type WhyEdge =
  | { type: "structure"; from: string; to: string }
  | { type: "affects"; from: string; to: string; decisionId: string }
  | { type: "evidence"; from: string; to: string; evidenceId: string };

export interface WhyModel {
  subjects: WhySubject[];
  decisions: WhyDecision[];
  evidence: WhyEvidence[];
  edges: WhyEdge[];
}

export interface BuildWhyModelInput extends DecisionInputs {
  goals: Goal[];
  scenarios: Scenario[];
  tasks: Task[];
  bugs: Bug[];
  scores: Score[];
  testRuns: TestRun[];
  verifications: Verification[];
  currentTaskId?: string | null;
}

const SCEN = (id: string) => `scenario:${id}`;
const TASK = (id: string) => `task:${id}`;

export function buildWhyModel(inp: BuildWhyModelInput): WhyModel {
  const subjects: WhySubject[] = [];
  const buggedScenarios = new Set(inp.bugs.filter((b) => b.status !== "fixed" && b.severity === "high" && b.scenarioId).map((b) => b.scenarioId as string));

  for (const g of inp.goals) subjects.push({ id: `goal:${g.id}`, kind: "goal", label: g.title ?? g.id });
  for (const s of inp.scenarios) {
    const ex = explainScenario(s, inp.scores, inp.testRuns, inp.verifications);
    subjects.push({ id: SCEN(s.id), kind: "scenario", label: s.title ?? s.id, explanation: buggedScenarios.has(s.id) ? { ...ex, state: "bugged" } : ex });
  }
  for (const t of inp.tasks) subjects.push({ id: TASK(t.id), kind: "task", label: t.title ?? t.id, loopId: t.loopId, explanation: { state: t.id === inp.currentTaskId ? "active" : "neutral", reasons: [] } });
  for (const b of inp.bugs) subjects.push({ id: `bug:${b.id}`, kind: "bug", label: b.title ?? b.id, loopId: b.loopId, explanation: { state: "bugged", reasons: [] } });

  const ids = new Set(subjects.map((s) => s.id));
  const edges: WhyEdge[] = [];
  const structure = (from: string, to: string) => { if (ids.has(from) && ids.has(to)) edges.push({ type: "structure", from, to }); };
  for (const s of inp.scenarios) if (s.goalId) structure(`goal:${s.goalId}`, SCEN(s.id));
  for (const t of inp.tasks) for (const sid of t.scenarioIds ?? []) structure(SCEN(sid), TASK(t.id));

  const decisions = toDecisions(inp);
  for (const d of decisions) {
    for (const sid of d.refs.scenarioIds) if (ids.has(SCEN(sid))) edges.push({ type: "affects", from: d.id, to: SCEN(sid), decisionId: d.id });
    for (const tid of d.refs.taskIds) if (ids.has(TASK(tid))) edges.push({ type: "affects", from: d.id, to: TASK(tid), decisionId: d.id });
  }

  const evidence: WhyEvidence[] = [];
  const addEv = (id: string, kind: WhyEvidence["kind"], scenarioId: string | undefined, relation: WhyEvidence["relation"], detail: Record<string, unknown>) => {
    if (!scenarioId || !ids.has(SCEN(scenarioId))) return;
    evidence.push({ id, kind, subjectId: SCEN(scenarioId), relation, detail });
    edges.push({ type: "evidence", from: id, to: SCEN(scenarioId), evidenceId: id });
  };
  for (const s of inp.scores) addEv(s.id, "score", s.scenarioId, "supports", { composite: s.composite, criteria: s.criteria, note: s.note });
  for (const r of inp.testRuns) addEv(r.id, "test-run", r.scenarioId, "supports", { failed: r.failed, issues: r.issues });
  for (const v of inp.verifications) addEv(v.id, "verification", v.scenarioId, v.verdict === "refuted" ? "refutes" : "supports", { verdict: v.verdict, summary: v.summary });

  return { subjects, decisions, evidence, edges };
}
```

- [ ] **Step 4: Run to verify it passes + full suite**

Run: `cd web && npm test -- whyModel` (expect PASS), then `npm test` (full suite green) and `npm run build` (clean).

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard/whyModel.ts web/src/dashboard/whyModel.test.ts
git commit -m "feat(web): buildWhyModel — subjects + evidence + causal edges"
```

---

## Task 10: Final verification

- [ ] **Step 1: Backend** — `cd functions && npm run build && npm test && npm run test:rules` (all green).
- [ ] **Step 2: Web** — `cd web && npm test && npm run build` (all green).
- [ ] **Step 3: CLI copies in sync** — `bash scripts/sync-autoloop-cli.sh` then `git status` shows no diff in the copies.
- [ ] **Step 4: Confirm SP1 scope** — no UI surface was added; `whyModel.ts` is not yet imported by any component (that's SP2). Grep: `grep -rl whyModel web/src` returns only `whyModel.ts` + `whyModel.test.ts`.
- [ ] **Step 5: Push + open PR** (only when the user asks).

```bash
git push -u origin loop-why-model
gh pr create --base main --title "SP1: loop \"why\" model + decision record" --body "Implements docs/superpowers/specs/2026-06-28-loop-why-model-design.md. Model + capture + tests, no UI (SP2/SP3 render it). Note: explainScenario corrects met/unmet to the canonical 3-condition rule (refuted ⇒ unmet)."
```

---

## Notes for the implementer

- **Don't wire `whyModel.ts` into any component.** SP1 is data + derivation only. If you feel the urge to render it, that's SP2.
- **The met-state change is intentional.** `explainScenario` is verification-aware; the legacy `deriveScenarioState` is not. They will disagree on a refuted-but-high scenario until SP2 consolidates. Do not "fix" `deriveScenarioState` in this plan.
- **ULID id regex** for tests: `/^[0-9A-HJKMNP-TV-Z]{26}$/` (uppercase Crockford), matching `ulid()`.
- **Emulator + Java** are required for `functions` tests that touch Firestore (`npm test` self-launches them). Pure schema/CLI tests run under `npm run test:run`.
