# Autoloop — Notifications design spec

**Date:** 2026-06-03
**Status:** approved (brainstorming) — pending spec review + user review
**Sub-project:** #6 of the "vision-driven loop" initiative. Notifies team members when a
scenario flips met↔unmet or a loop completes, via in-app notifications. Builds on the
loop contract (#1) and the tracking UI (#4); changes nothing in the loop/CLI/skills.

## Goal

A loop runs unattended; users want to be alerted **without watching the dashboard**.
This adds **in-app notifications** for the meaningful state changes: a scenario flipping
**met** (good) or **unmet** (regression), and a **loop completing** (all targeted
scenarios met, or the project status reaching `completed`). Delivered as a header
**bell + dropdown** in the web app.

## Architecture

A new **Firestore-triggered Cloud Function** watches writes to `scores`, `testRuns`,
and project docs. On a score/testRun write it recomputes the affected scenario's
met/unmet state (the contract rule: latest-by-document-id `composite ≥ threshold` AND
latest `testRun.failed == 0`), compares it to a **denormalized `lastNotifiedState`**
stored on the scenario doc, and **only on an actual change** writes an in-app
**notification** document (Admin SDK) and updates `lastNotifiedState`. This keeps
notifications reactive (fires regardless of who wrote — loop, web, future) and
spam-free (per state change, not per event). The **decision logic is a pure,
unit-tested function**; the trigger is a thin Firestore adapter around it.

Notifications are **in-app only** in v1: documents under `teams/{teamId}/notifications`,
member-readable, written only by the trigger. The web renders them; "unread" is tracked
client-side (a `localStorage` last-seen marker) — **no client write path** for
notifications in v1.

The deploy gains a **second function** (the trigger) alongside the existing HTTP `api`.
One **small additive rules block** grants member read to team notifications (the
existing recursive read-rule only covers `projects/{slug}/**`).

## Domain

**Notification** (`teams/{teamId}/notifications/{id}`) — id is a server-generated
sortable ULID (reuse `functions/src/ulid.ts`):
```
{ type: "scenario_met" | "scenario_unmet" | "loop_complete",
  projectSlug, scenarioId?, title, message, createdAt }
```
**Scenario** gains a server-owned `lastNotifiedState?: "met" | "unmet"` (written only by
the trigger; never client-settable; the zod `scenarioBody` drops it on agent/web writes
since it's an unknown key — confirm it is not in the schema).

## Components (backend)

- **`functions/src/notify/decide.ts`** (pure, no Firestore): mirrors the contract's
  derivation. `deriveState(scenario, scores, testRuns) → "met" | "unmet"` (latest-by-id;
  threshold default 80; missing score/test ⇒ unmet). `decideScenarioNotification(scenario,
  scores, testRuns, lastState) → { newState, type?: "scenario_met"|"scenario_unmet" }`
  — `type` set only when `newState !== lastState` (and a prior state existed or the new
  state is `met`; see "first-write" below). `allMet(scenarios, scoresByScn, testRunsByScn)
  → boolean` for loop-complete.
  - **First-write rule:** when `lastState` is absent (undefined), notify only if the
    computed state is `met` (a brand-new scenario that's immediately met is worth a
    `scenario_met`); an initial `unmet` is not a "flip" and is silent. After the first
    write, `lastNotifiedState` is always set and flips both ways notify.
- **`functions/src/notify/trigger.ts`** — firebase-functions v2 handlers:
  - `onScoreOrTestRunWritten` (`onDocumentWritten` on
    `teams/{teamId}/projects/{slug}/scores/{id}` and `.../testRuns/{id}` — two exports or
    one shared handler): read the written doc's `scenarioId`, load the scenario + its
    `scores` and `testRuns` (filtered by `scenarioId`), call `decideScenarioNotification`
    against `scenario.lastNotifiedState`; if a `type` results, write a notification doc +
    `tx`-update the scenario's `lastNotifiedState`. **`allMet` is over ALL scenarios in
    the project** (true iff ≥1 scenario and every one is `met` — matches the #4 banner's
    `met === total && total > 0`; a project with no scenarios is NOT complete). There is
    no "targeted subset". Then: if this write made the new state `met` and `allMet` is now
    true, write a `loop_complete` notification, deduped by a project
    `lastLoopCompleteNotified` flag (set when emitting `loop_complete`). **Reset rule:**
    whenever a scenario flips to `unmet` (the `scenario_unmet` path), CLEAR
    `lastLoopCompleteNotified` — so a project that completes, regresses, then completes
    again emits a second `loop_complete`. Without this reset the flag would permanently
    suppress later completions (a real bug).
  - `onProjectWritten` (`onDocumentWritten` on `teams/{teamId}/projects/{slug}`): if
    `before.status !== "completed" && after.status === "completed"`, write a
    `loop_complete` notification. **Self-trigger caution:** this handler also fires on the
    trigger's own project writes (`lastLoopCompleteNotified`, `currentTaskId`, etc.), so
    EVERY branch must edge-guard on a before/after transition (`before.x !== after.x`) and
    never act on mere field presence — otherwise it loops. The status-edge guard above
    already does this; keep that discipline. (The status-driven and scores-driven
    `loop_complete` paths are distinct edges; the dedup flag prevents a double-fire when
    both occur for the same completion, and the unmet-reset re-arms it for the next.)
  - **Region:** pin the trigger function to `us-central1` (matching the existing `api`
    function and co-locating with Firestore) to avoid a surprise cross-region deploy.
  - All writes are best-effort/idempotent; a handler error is logged and does not retry
    destructively (the function may retry — writes are guarded by the state comparison +
    dedup flag so a retry is a no-op).
- **`functions/src/index.ts`** — export the trigger function(s) alongside `api`.

## Components (rules)

Add inside `match /teams/{teamId}`:
```
match /notifications/{notifId} {
  allow read: if isMember(teamId);
  allow write: if false;   // trigger writes via Admin SDK
}
```
No other rules change. A rules test asserts member-read / non-member-deny /
client-write-deny.

## Components (web)

- **`useTeamNotifications(teamId)`** hook (mirrors the existing `Result<T>`+`onSnapshot`
  pattern): `teams/{teamId}/notifications` ordered by document id desc, limited to a
  recent N (e.g. 50).
- **`NotificationsBell`** in the header (`web/src/routes/AppShell.tsx`): reads the user's
  teams (`useMyTeams`) and their notifications, merges + sorts by id desc, shows an
  unread count = number newer than the `localStorage` `autoloop:notifs:lastSeen` id;
  opening the dropdown updates `lastSeen` to the newest id (clears the count). Each row
  shows the title/message + relative time; click → navigate to
  `/dashboard/{teamId}/{slug}` (and, if scenarioId, that project page). Empty state when
  none.

## Data flow

loop/web writes a score or testRun → Firestore trigger fires → recompute scenario state
→ compare to `lastNotifiedState` → on change: write notification + update state (and
maybe `loop_complete`) → the web bell (live `onSnapshot`) shows the new unread.

## Error handling

- Trigger: wrap in try/catch, log errors (Cloud Run logs); never throw in a way that
  causes infinite retry of a non-idempotent write — the state-comparison + dedup flags
  make a retry a no-op. A failed notification never affects the loop (the trigger is
  downstream of the write that already succeeded).
- Web: a failed notifications subscription degrades to "no notifications" (bell shows 0),
  never blocks the page.

## Testing

- **`decide.ts`** — pure Vitest unit tests: flip unmet→met (notify met), met→unmet
  (notify unmet/regression), no-flip (no notify), first-write met (notify) vs first-write
  unmet (silent), `allMet` true/false, threshold boundary + latest-by-id.
- **Trigger** — Firestore-emulator integration test: writing a passing score+testRun for
  a scenario produces a `scenario_met` notification and sets `lastNotifiedState`; a
  second identical write produces NO duplicate; a failing testRun after met produces a
  `scenario_unmet`; completing the last scenario / setting project status `completed`
  produces one `loop_complete`. (Use the firebase-functions test invocation or drive the
  emulator and assert the notifications collection.)
- **Rules** — member-read / non-member-deny / client-write-deny on
  `teams/{teamId}/notifications`.
- **Web** — `NotificationsBell` render tests (mocked notifications + teams): unread count
  vs `lastSeen`, opening clears the count, click navigates, empty state.
- `functions` + `web` builds clean; existing suites green; `npm run test:rules` green.

## Out of scope (deferred)

- Email / webhook / push delivery (in-app only in v1).
- Server-side per-user read receipts (v1 uses a `localStorage` last-seen marker).
- A global `collectionGroup` notifications feed (v1 reads per-team, aggregated client-side).
- Notification preferences / muting.

## Success criteria

- When a scenario flips met↔unmet (via any writer), a notification appears in the team's
  `notifications` collection and in the web bell, exactly once per flip (no per-score spam).
- When all targeted scenarios become met, or a project's status reaches `completed`, a
  single `loop_complete` notification fires.
- A team member sees notifications in the header bell with an accurate unread count;
  non-members cannot read them; clients cannot write them (rules).
- The trigger is idempotent under retry (no duplicate notifications).
- API/loop/CLI behavior is unchanged; `functions` + `web` + rules suites green.
