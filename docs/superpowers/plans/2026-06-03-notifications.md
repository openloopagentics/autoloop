# Notifications Implementation Plan (#6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify team members in-app when a scenario flips met↔unmet or a loop completes — via a new Firestore-triggered Cloud Function that detects flips against a denormalized `lastNotifiedState` and writes notification docs, plus a header bell in the web app.

**Architecture:** A pure `decide.ts` (flip/loop-complete logic, unit-tested) + a `notifier.ts` core (`processScenarioEvent`/`processProjectStatusChange` — read scenario+events, decide, write notification + update `lastNotifiedState`/dedup flag against the Firestore emulator, directly testable) + thin `onDocumentWritten` adapters in `trigger.ts` (exported from `index.ts`). One additive Firestore-rules block (member-read team notifications). Web: `useTeamNotifications` hook + `NotificationsBell` in the header (localStorage unread). The harness runs only the Firestore emulator, so triggers are tested by calling the `notifier.ts` core directly — the `onDocumentWritten` wrapper is a thin, untested adapter.

**Tech Stack:** firebase-functions v2 (`onDocumentWritten` from `firebase-functions/v2/firestore`, ^6.6.0), firebase-admin, Vitest + Firestore emulator (`functions/test/`), React + Firebase JS SDK + Vitest/jsdom (`web/`). No new deps. Reuse `functions/src/ulid.ts`.

**Reference spec:** `docs/superpowers/specs/2026-06-03-notifications-design.md`

---

## Background / conventions (read before Task 1)

- **`scenario.lastNotifiedState`** (`"met" | "unmet"`, server-only) is the flip-detection memory, written ONLY by the notifier (Admin SDK). It's not in `scenarioBody` (plain `z.object` drops unknown keys), so agent/web merge-writes never clobber it.
- **The derivation mirrors the contract** (and `web/src/dashboard/scenarioState.ts`): latest-by-document-id score `composite ≥ (threshold ?? 80)` AND latest testRun `failed === 0`; missing score/test ⇒ unmet. Duplicated in `functions/` (separate package) — keep it pure + tested.
- **`allMet`** = `≥1 scenario AND every scenario met` (project with no scenarios ⇒ not complete).
- **loop_complete dedup + reset:** a project field `lastLoopCompleteNotified: boolean`. Set true when emitting `loop_complete`; **cleared whenever any scenario flips to `unmet`** (so re-completion re-fires). The project-status path edge-guards on `before.status !== "completed" && after.status === "completed"`.
- **Self-trigger caution:** `onProjectWritten` fires on the notifier's own project writes — every branch MUST edge-guard on a before/after transition, never act on field presence.
- **Notifications live at** `teams/{teamId}/notifications/{ulid}` — written only by the notifier; member-readable via a new rules block (the recursive read-rule only covers `projects/{slug}/**`).
- **Trigger testing:** the harness is `firebase emulators:exec --only firestore "vitest run"` — it does NOT run the functions emulator, so `onDocumentWritten` won't fire in tests. Test the **`notifier.ts` core functions** directly (seed Firestore via Admin SDK, call the function, assert the notifications collection). The `trigger.ts` adapters are thin and verified only by `npm run build`.
- **Test harness:** `functions/test/*.test.ts` + `helpers.ts` (clears Firestore + seeds test key each `beforeEach`). Run: `cd functions && npm test` (full, boots emulator) / `npm run test:run -- <name>` (running emulator) / `npm run build`. Web: `cd web && npm test` / `npm run build`. Rules: `npm run test:rules`. Region: pin triggers to `us-central1`. Do NOT `git add -A`.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `functions/src/notify/decide.ts` | pure: `deriveState`, `decideScenarioNotification`, `allMet` | 1 |
| `functions/test/notify-decide.test.ts` | pure unit tests | 1 |
| `functions/src/notify/notifier.ts` | core: `processScenarioEvent(teamId,slug,scenarioId)`, `processProjectStatusChange(teamId,slug,before,after)` (read→decide→write notification + lastNotifiedState + loop_complete/dedup) | 2 |
| `functions/test/notifier.test.ts` | emulator tests calling the core directly | 2 |
| `functions/src/notify/trigger.ts` | thin `onDocumentWritten` adapters | 3 |
| `functions/src/index.ts` | export the trigger functions | 3 |
| `firestore.rules` | add `teams/{teamId}/notifications` member-read block | 4 |
| `functions/test-rules/rules.test.ts` | notifications read/deny test | 4 |
| `web/src/dashboard/hooks.ts` | `useTeamNotifications(teamId)` | 5 |
| `web/src/notifications/NotificationsBell.tsx` (+ types) | header bell + unread (localStorage) | 5 |
| `web/src/routes/AppShell.tsx` | mount the bell in `hdr-actions` | 5 |
| `web/src/notifications/NotificationsBell.test.tsx` | render + unread tests | 5 |

---

## Task 1: `decide.ts` — pure flip/loop-complete logic

**Files:** Create `functions/src/notify/decide.ts`, `functions/test/notify-decide.test.ts`.

- [ ] **Step 1: Write the failing test** (`functions/test/notify-decide.test.ts`)

```typescript
import { describe, it, expect } from "vitest";
import { deriveState, decideScenarioNotification, allMet } from "../src/notify/decide.js";

const scn = (over = {}) => ({ id: "s1", threshold: 80, ...over });
const score = (id: string, composite: number, scenarioId = "s1") => ({ id, scenarioId, composite });
const run = (id: string, failed: number, scenarioId = "s1") => ({ id, scenarioId, failed });

describe("deriveState", () => {
  it("met when latest composite>=threshold and latest failed==0", () => {
    expect(deriveState(scn(), [score("01A", 85)], [run("01A", 0)])).toBe("met");
  });
  it("unmet below threshold or with failures or missing data", () => {
    expect(deriveState(scn(), [score("01A", 70)], [run("01A", 0)])).toBe("unmet");
    expect(deriveState(scn(), [score("01A", 95)], [run("01A", 1)])).toBe("unmet");
    expect(deriveState(scn(), [], [run("01A", 0)])).toBe("unmet");
    expect(deriveState(scn(), [score("01A", 95)], [])).toBe("unmet");
  });
  it("default threshold 80", () => {
    expect(deriveState(scn({ threshold: undefined }), [score("01A", 80)], [run("01A", 0)])).toBe("met");
  });
});

describe("decideScenarioNotification", () => {
  const S = [score("01A", 90)], R = [run("01A", 0)];
  it("first-write met → notify scenario_met", () => {
    expect(decideScenarioNotification(scn(), S, R, undefined)).toEqual({ newState: "met", type: "scenario_met" });
  });
  it("first-write unmet → silent", () => {
    expect(decideScenarioNotification(scn(), [score("01A", 10)], R, undefined)).toEqual({ newState: "unmet" });
  });
  it("met→unmet flip → scenario_unmet", () => {
    expect(decideScenarioNotification(scn(), [score("01A", 10)], R, "met")).toEqual({ newState: "unmet", type: "scenario_unmet" });
  });
  it("unmet→met flip → scenario_met", () => {
    expect(decideScenarioNotification(scn(), S, R, "unmet")).toEqual({ newState: "met", type: "scenario_met" });
  });
  it("no flip → no type", () => {
    expect(decideScenarioNotification(scn(), S, R, "met")).toEqual({ newState: "met" });
  });
});

describe("allMet", () => {
  it("true iff >=1 scenario and all met", () => {
    expect(allMet([{ id: "s1" }], { s1: [score("01A", 90, "s1")] }, { s1: [run("01A", 0, "s1")] })).toBe(true);
    expect(allMet([], {}, {})).toBe(false);
    expect(allMet([{ id: "s1" }, { id: "s2" }], { s1: [score("01A", 90, "s1")], s2: [score("01A", 10, "s2")] }, { s1: [run("01A", 0, "s1")], s2: [run("01A", 0, "s2")] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run → fail** — `cd functions && npm run test:run -- notify-decide`.

- [ ] **Step 3: Implement** (`functions/src/notify/decide.ts`)

```typescript
export type State = "met" | "unmet";
interface HasId { id: string }
interface ScoreLike extends HasId { scenarioId?: string; composite?: number }
interface RunLike extends HasId { scenarioId?: string; failed?: number }
interface ScenarioLike { id: string; threshold?: number }

export const DEFAULT_THRESHOLD = 80;
function latestById<T extends HasId>(xs: T[]): T | null {
  let best: T | null = null;
  for (const x of xs) if (best === null || x.id > best.id) best = x;
  return best;
}

export function deriveState(scenario: ScenarioLike, scores: ScoreLike[], testRuns: RunLike[]): State {
  const s = latestById(scores.filter((x) => x.scenarioId === scenario.id));
  const r = latestById(testRuns.filter((x) => x.scenarioId === scenario.id));
  const threshold = scenario.threshold ?? DEFAULT_THRESHOLD;
  const met = s != null && (s.composite ?? -1) >= threshold && r != null && (r.failed ?? 0) === 0;
  return met ? "met" : "unmet";
}

/** newState + a notification type when it should fire. First write: notify only if met. */
export function decideScenarioNotification(scenario: ScenarioLike, scores: ScoreLike[], testRuns: RunLike[], lastState: State | undefined): { newState: State; type?: "scenario_met" | "scenario_unmet" } {
  const newState = deriveState(scenario, scores, testRuns);
  if (lastState === undefined) return newState === "met" ? { newState, type: "scenario_met" } : { newState };
  if (newState === lastState) return { newState };
  return { newState, type: newState === "met" ? "scenario_met" : "scenario_unmet" };
}

export function allMet(scenarios: ScenarioLike[], scoresByScn: Record<string, ScoreLike[]>, runsByScn: Record<string, RunLike[]>): boolean {
  if (scenarios.length === 0) return false;
  return scenarios.every((s) => deriveState(s, scoresByScn[s.id] ?? [], runsByScn[s.id] ?? []) === "met");
}
```

- [ ] **Step 4: Run → pass** — `cd functions && npm run test:run -- notify-decide` (all).
- [ ] **Step 5: Commit** — `git add functions/src/notify/decide.ts functions/test/notify-decide.test.ts && git commit -m "feat(api): pure notification decision logic (flip + loop-complete)"`.

---

## Task 2: `notifier.ts` core + emulator tests

**Files:** Create `functions/src/notify/notifier.ts`, `functions/test/notifier.test.ts`.

- [ ] **Step 1: Write the failing test** (`functions/test/notifier.test.ts`)

```typescript
import { describe, it, expect } from "vitest";
import "./helpers.js";
import { db } from "../src/firestore.js";
import { ulid } from "../src/ulid.js";
import { processScenarioEvent, processProjectStatusChange } from "../src/notify/notifier.js";

const P = "teams/t1/projects/web";
async function seedScenario(threshold = 80) {
  await db().doc(`${P}/scenarios/s1`).set({ goalId: "g1", title: "Login", threshold, rubric: { criteria: [] } });
}
async function addScore(composite: number) { await db().doc(`${P}/scores/${ulid()}`).set({ scenarioId: "s1", taskId: "t", composite }); }
async function addRun(failed: number) { await db().doc(`${P}/testRuns/${ulid()}`).set({ scenarioId: "s1", taskId: "t", passed: 1, failed }); }
async function notifs() { return (await db().collection(`teams/t1/notifications`).get()).docs.map((d) => d.data()); }

describe("processScenarioEvent", () => {
  it("writes scenario_met on first met + sets lastNotifiedState; no dup on re-run", async () => {
    await seedScenario(); await addScore(90); await addRun(0);
    await processScenarioEvent("t1", "web", "s1");
    let ns = await notifs();
    expect(ns.filter((n) => n.type === "scenario_met")).toHaveLength(1);
    expect((await db().doc(`${P}/scenarios/s1`).get()).data()!.lastNotifiedState).toBe("met");
    await processScenarioEvent("t1", "web", "s1"); // no change
    expect((await notifs()).filter((n) => n.type === "scenario_met")).toHaveLength(1);
  });
  it("writes scenario_unmet on regression and clears lastLoopCompleteNotified", async () => {
    await seedScenario(); await addScore(90); await addRun(0);
    await processScenarioEvent("t1", "web", "s1"); // met (also loop_complete since all met)
    await db().doc(P).set({ lastLoopCompleteNotified: true }, { merge: true });
    await addRun(2); // now failing
    await processScenarioEvent("t1", "web", "s1");
    expect((await notifs()).filter((n) => n.type === "scenario_unmet")).toHaveLength(1);
    expect((await db().doc(P).get()).data()!.lastLoopCompleteNotified).toBe(false);
  });
  it("emits a single loop_complete when all scenarios met", async () => {
    await seedScenario(); await addScore(90); await addRun(0);
    await processScenarioEvent("t1", "web", "s1");
    expect((await notifs()).filter((n) => n.type === "loop_complete")).toHaveLength(1);
    await processScenarioEvent("t1", "web", "s1");
    expect((await notifs()).filter((n) => n.type === "loop_complete")).toHaveLength(1); // deduped
  });
});

describe("processProjectStatusChange", () => {
  it("emits loop_complete on status →completed (edge only)", async () => {
    await db().doc(P).set({ slug: "web", title: "W", status: "running" });
    await processProjectStatusChange("t1", "web", "running", "completed");
    expect((await notifs()).filter((n) => n.type === "loop_complete")).toHaveLength(1);
    await processProjectStatusChange("t1", "web", "completed", "completed"); // no edge
    expect((await notifs()).filter((n) => n.type === "loop_complete")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run → fail** — `cd functions && npm test -- notifier`.

- [ ] **Step 3: Implement** (`functions/src/notify/notifier.ts`) — read/decide/write against Firestore (Admin SDK). Sketch:

```typescript
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { ulid } from "../ulid.js";
import { decideScenarioNotification, allMet, type State } from "./decide.js";

async function writeNotification(teamId: string, n: { type: string; projectSlug: string; scenarioId?: string; title: string; message: string }) {
  await db().doc(`teams/${teamId}/notifications/${ulid()}`).set({ ...n, createdAt: FieldValue.serverTimestamp() });
}
async function colById(path: string) {
  return (await db().collection(path).get()).docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Array<{ id: string }>;
}

/** Recompute one scenario's state on a score/testRun write; emit flip notifications + maybe loop_complete. */
export async function processScenarioEvent(teamId: string, slug: string, scenarioId: string): Promise<void> {
  const base = `teams/${teamId}/projects/${slug}`;
  const scnSnap = await db().doc(`${base}/scenarios/${scenarioId}`).get();
  if (!scnSnap.exists) return;
  const scenario = { id: scenarioId, threshold: scnSnap.data()!.threshold as number | undefined };
  const lastState = scnSnap.data()!.lastNotifiedState as State | undefined;
  const scores = await colById(`${base}/scores`) as Array<{ id: string; scenarioId?: string; composite?: number }>;
  const testRuns = await colById(`${base}/testRuns`) as Array<{ id: string; scenarioId?: string; failed?: number }>;
  const { newState, type } = decideScenarioNotification(scenario, scores, testRuns, lastState);

  if (newState !== lastState) {
    await db().doc(`${base}/scenarios/${scenarioId}`).set({ lastNotifiedState: newState }, { merge: true });
  }
  if (type === "scenario_unmet") {
    await db().doc(base).set({ lastLoopCompleteNotified: false }, { merge: true }); // re-arm
  }
  if (type) {
    const title = type === "scenario_met" ? "Scenario met" : "Scenario regressed";
    await writeNotification(teamId, { type, projectSlug: slug, scenarioId, title, message: `${scenarioId} is now ${newState}` });
  }
  // loop_complete: only consider when this write made things met
  if (newState === "met") {
    const scenarios = (await colById(`${base}/scenarios`)) as Array<{ id: string }>;
    const byScn = <T extends { scenarioId?: string }>(xs: T[]) => Object.fromEntries(scenarios.map((s) => [s.id, xs.filter((x) => x.scenarioId === s.id)]));
    if (allMet(scenarios, byScn(scores), byScn(testRuns))) {
      const projSnap = await db().doc(base).get();
      if (projSnap.data()?.lastLoopCompleteNotified !== true) {
        await db().doc(base).set({ lastLoopCompleteNotified: true }, { merge: true });
        await writeNotification(teamId, { type: "loop_complete", projectSlug: slug, title: "Loop complete", message: "All scenarios met" });
      }
    }
  }
}

/** On project status edge → completed, emit one loop_complete. */
export async function processProjectStatusChange(teamId: string, slug: string, before: string | undefined, after: string | undefined): Promise<void> {
  if (before === "completed" || after !== "completed") return; // edge guard
  const base = `teams/${teamId}/projects/${slug}`;
  const projSnap = await db().doc(base).get();
  if (projSnap.data()?.lastLoopCompleteNotified === true) return;
  await db().doc(base).set({ lastLoopCompleteNotified: true }, { merge: true });
  await writeNotification(teamId, { type: "loop_complete", projectSlug: slug, title: "Loop complete", message: "Project marked completed" });
}
```

NOTE on `scores` read for `allMet`: re-use the already-fetched `scores`/`testRuns` arrays (don't re-query). The `byScn` grouping above does this.

- [ ] **Step 4: Run → pass** — `cd functions && npm test -- notifier`.
- [ ] **Step 5: Commit** — `git add functions/src/notify/notifier.ts functions/test/notifier.test.ts && git commit -m "feat(api): notifier core (flip + loop-complete with dedup/reset)"`.

---

## Task 3: Firestore-trigger adapters + export

**Files:** Create `functions/src/notify/trigger.ts`; Modify `functions/src/index.ts`.

- [ ] **Step 1: Implement `trigger.ts`** — thin v2 adapters that extract params and call the notifier core. Region pinned to `us-central1`.

```typescript
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { processScenarioEvent, processProjectStatusChange } from "./notifier.js";

const region = "us-central1";

export const onScoreWritten = onDocumentWritten({ document: "teams/{teamId}/projects/{slug}/scores/{id}", region }, async (event) => {
  const { teamId, slug } = event.params as { teamId: string; slug: string };
  const scenarioId = (event.data?.after?.data()?.scenarioId ?? event.data?.before?.data()?.scenarioId) as string | undefined;
  if (scenarioId) await processScenarioEvent(teamId, slug, scenarioId);
});

export const onTestRunWritten = onDocumentWritten({ document: "teams/{teamId}/projects/{slug}/testRuns/{id}", region }, async (event) => {
  const { teamId, slug } = event.params as { teamId: string; slug: string };
  const scenarioId = (event.data?.after?.data()?.scenarioId ?? event.data?.before?.data()?.scenarioId) as string | undefined;
  if (scenarioId) await processScenarioEvent(teamId, slug, scenarioId);
});

export const onProjectStatusWritten = onDocumentWritten({ document: "teams/{teamId}/projects/{slug}", region }, async (event) => {
  const { teamId, slug } = event.params as { teamId: string; slug: string };
  const before = event.data?.before?.data()?.status as string | undefined;
  const after = event.data?.after?.data()?.status as string | undefined;
  await processProjectStatusChange(teamId, slug, before, after);
});
```

(Each handler wraps its body in try/catch and logs — a failed notification must not crash; the core's state/dedup guards make a retry a no-op. Add `try { … } catch (e) { console.error("notify trigger:", (e as Error).message); }` inside each.)

- [ ] **Step 2: Export** (`functions/src/index.ts`) — add:
```typescript
export { onScoreWritten, onTestRunWritten, onProjectStatusWritten } from "./notify/trigger.js";
```

- [ ] **Step 3: Build** — `cd functions && npm run build` → 0 errors (verifies the v2 trigger types). The adapters aren't unit-tested (the harness runs only the Firestore emulator); the core logic is covered by Task 2.

- [ ] **Step 4: Commit** — `git add functions/src/notify/trigger.ts functions/src/index.ts && git commit -m "feat(api): Firestore-trigger adapters for notifications (us-central1)"`.

---

## Task 4: Firestore rules for notifications

**Files:** Modify `firestore.rules`, `functions/test-rules/rules.test.ts`.

- [ ] **Step 1: Add the rules block** — inside `match /teams/{teamId} {`, alongside members/invites/projects:
```
match /notifications/{notifId} {
  allow read: if isMember(teamId);
  allow write: if false;
}
```

- [ ] **Step 2: Add a rules test** (in `functions/test-rules/rules.test.ts`, a new describe) — seed `teams/t1` + member alice + a notification doc (via `withSecurityRulesDisabled`); assert: member alice reads it (assertSucceeds); non-member bob cannot (assertFails); a client write is denied (assertFails). Mirror the existing project-isolation tests' style.

- [ ] **Step 3: Run** — `cd functions && npm run test:rules` → all green (existing + new).
- [ ] **Step 4: Commit** — `git add firestore.rules functions/test-rules/rules.test.ts && git commit -m "feat(rules): member-read team notifications (client-write-denied)"`.

---

## Task 5: Web — `useTeamNotifications` + `NotificationsBell` + header

**Files:** Modify `web/src/dashboard/hooks.ts`, `web/src/routes/AppShell.tsx`; Create `web/src/notifications/NotificationsBell.tsx`, `web/src/notifications/types.ts`, `web/src/notifications/NotificationsBell.test.tsx`; CSS in `web/src/index.css`.

- [ ] **Step 1: Add `useTeamNotifications`** to `hooks.ts` — mirror `usePhases`: `query(collection(db, "teams", teamId, "notifications"), orderBy(documentId(), "desc"), limit(50))` → `Result<Notification[]>`. (Import `limit` from firebase/firestore.) Type `Notification = { id; type; projectSlug; scenarioId?; title?; message?; createdAt? }` in `notifications/types.ts`.

- [ ] **Step 2: Failing test** (`NotificationsBell.test.tsx`) — the bell takes its data via props (presentational + a container does the hooks), so test a presentational `NotificationsList`/`Bell` with: given notifications + a `lastSeenId`, the unread count = number with `id > lastSeenId`; rendering the list shows titles; clicking the bell calls `onOpen` (which would persist lastSeen). Use `@testing-library/react` + `vi.fn()`. Keep the hook-driven aggregation in a thin container that the test doesn't cover (consistent with other dashboard hooks being untested).

- [ ] **Step 3: Implement `NotificationsBell.tsx`** — a container that reads `useMyTeams()` → for each team `useTeamNotifications(teamId)` (call hooks in a stable list; since team count is dynamic, render one small `<TeamNotifs teamId onData>` child per team that reports its data up, OR for v1 read only the first N teams — simplest robust: a child component per team, mirroring the `LegacyPhase`/`PlanTask` container pattern from #4). Merge all notifications, sort by `id` desc, compute unread vs `localStorage.getItem("daloop:notifs:lastSeen")`. Render a bell button with an unread badge; on open, show a dropdown list (title + message + relative time, link to `/dashboard/${teamId}/${slug}`) and set `lastSeen` to the newest id (clearing the badge). Empty state "No notifications".
  - Presentational bits (badge count, list) are the tested units; the per-team data plumbing is the untested container.

- [ ] **Step 4: Mount in `AppShell.tsx`** — render `<NotificationsBell />` inside `.hdr-actions` (before or after the "Getting started" link). Add CSS for `.bell`, `.bell-badge`, `.notif-dropdown`, `.notif-row` on the existing palette.

- [ ] **Step 5: Run** — `cd web && npm test` (bell tests + existing green) and `npm run build` (clean).
- [ ] **Step 6: Commit** — `git add web/src/dashboard/hooks.ts web/src/notifications/ web/src/routes/AppShell.tsx web/src/index.css && git commit -m "feat(web): notifications bell in the header (per-team, localStorage unread)"`.

---

## Task 6: Verification

- [ ] **Step 1:** `cd functions && npm test` → all green (decide + notifier + existing). 
- [ ] **Step 2:** `cd functions && npm run build` → clean; `npm run test:rules` → green (incl. new notifications test).
- [ ] **Step 3:** `cd web && npm test` + `npm run build` → green/clean.
- [ ] **Step 4:** Confirm success criteria: flips emit exactly one notification (no per-score spam); loop_complete fires once per completion and re-arms after a regression; member reads, non-member/client-write denied; the bell shows unread.
- [ ] **Step 5 (deploy note for the human):** shipping #6 requires **functions** (now 4 functions: api + 3 triggers), **hosting**, and **firestore:rules** deploys.

---

## Notes for the executor
- **Reads before writes / Admin SDK** — the notifier uses plain `db()` reads + sets (no transaction needed; idempotency comes from the state/dedup comparisons, and a duplicate notification on a rare race is acceptable — but the lastNotifiedState/lastLoopCompleteNotified guards make it very unlikely).
- **Triggers can't be unit-tested** in the firestore-only harness — that's why the logic lives in `notifier.ts` (tested directly) and `trigger.ts` is a thin adapter (build-verified). Do NOT try to assert trigger firing in a vitest test.
- **lastNotifiedState / lastLoopCompleteNotified are server-only** — never add them to a zod body or the web write path.
- **Edge-guard every project-trigger branch** (self-trigger). 
- No new deps. Do NOT `git add -A`.
