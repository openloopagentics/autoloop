# Daloop — Vision Editing in the Web UI design spec

**Date:** 2026-06-03
**Status:** approved (brainstorming) — pending spec review + user review
**Sub-project:** #5 of the "vision-driven loop" initiative. Adds a **user-authenticated
write path** so a signed-in team member can author and edit a project's vision
(goals, scenarios, rubrics, documents) from the browser — for projects **not** driven
by a local loop. Builds on the loop contract (#1) and the read-only tracking UI (#4).

## Goal

Today the web is strictly read-only: the loop owns the canonical vision locally
(`vision.json`), pushes it via the agent API key, and the browser only renders it.
Some users want to author/curate a vision **in the browser** (no local loop). This
adds **web-first vision authoring + editing** — create a project, add/edit/delete
goals, scenarios (with rubric + threshold), and documents — while preserving the
one-way model for loop-driven projects (they stay read-only in the web).

## Architecture

**A new user-authenticated, server-mediated write path.** Writes are authorized by
the signed-in user's **Firebase ID token + team membership** (exactly like `/v1/keys`
and `/v1/admin`), and the server performs the Firestore writes via the Admin SDK —
**Firestore rules stay client-write-forbidden** (the `match /projects/{slug}` block is
unchanged; clients never write project data directly). This keeps the existing
security invariant intact and reuses the existing zod validation.

**Ownership arbitration via a `visionOwner` project field** (`"web" | "loop"`):
- **Agent / API-key writes** (the existing `requireApiKeyMember` path used by the
  `daloop` CLI) stamp `visionOwner: "loop"`.
- **Web / ID-token writes** (the new path) require `visionOwner !== "loop"` and stamp
  `visionOwner: "web"`.
- **Loop wins:** if a loop reports against a web-authored project, the agent write
  takes ownership (`"loop"`) and the web becomes read-only thereafter. This is
  documented, deliberate behavior — a project is owned by whoever's actively driving
  it, and an active loop is authoritative.

The two auth modes live on **separate URL subtrees** so an ID token is never accepted
on the API-key path and vice-versa (honoring the existing separation in
`requireUser`/`requireApiKeyMember`).

## Backend

### Auth: `requireMember` middleware (`functions/src/requireMember.ts`)

`makeRequireUser()` already verifies the ID token, enforces `users/{uid}.isAllowed`,
and sets `req.uid`. `requireMember` runs **after** it and asserts `req.uid` is a
member of `req.params.teamId` (the membership half of `requireApiKeyMember`):
`teams/{teamId}/members/{uid}` exists → else `403 "not a member of this team"`.

### Mount (`functions/src/app.ts`)

```
app.use("/v1/u/teams/:teamId/projects", makeRequireUser(), requireMember, userProjectsRouter);
```
A distinct `/v1/u/...` subtree (the agent path stays at `/v1/teams/...`).

### Refactor existing upserts to shared `(tx, …)` inner helpers — resolves transaction nesting

The Firestore Admin SDK does **not** support nesting `runTransaction` inside another.
So the web path must **not** call the existing `upsertGoal`/`upsertScenario`/
`upsertDocument` (each opens its own transaction) from inside a guard transaction.
Instead, refactor each entity service to expose a **pure inner helper** that takes the
open `tx` and does the merge + project owner-stamp, and keep a thin public wrapper that
opens the transaction for the agent path. For example in `services/goals.ts`:

```
// inner: assumes an open tx + an already-existence-checked project; stamps the owner.
applyGoalUpsert(tx, projectRef, goalRef, body, owner: "web" | "loop")
upsertGoal(teamId, slug, goalId, body)   // agent wrapper: runTransaction → check project
                                          // → applyGoalUpsert(tx, …, "loop")
```

The agent wrapper preserves today's behavior **plus** stamps `visionOwner: "loop"`
via `tx.set(projectRef, { visionOwner: "loop" }, { merge: true })` **inside the same
transaction** (goals/scenarios/documents don't touch the project doc today, so this
adds one in-transaction project write; `upsertTask` already writes the project doc, so
it just adds the field). Stamping is applied to `upsertGoal`/`upsertScenario`/
`upsertDocument`/`upsertTask` — the "a loop is driving this" signals. Plain
`project set`/`phase` do **not** stamp owner, so a bare status board stays
web-editable.

### Ownership guard (`functions/src/services/visionOwner.ts`)

`assertWebEditable(tx, projectSnap)` — given the project snapshot read at the top of a
transaction: throws `404` if missing, `409 "project is loop-owned (read-only in the
web)"` if `visionOwner === "loop"`; otherwise returns. (No TOCTOU: the read and the
write happen in the **same** transaction.)

### `userProjectsRouter` (`functions/src/routes/userProjects.ts`)

`Router({ mergeParams: true })` so its `:teamId`/`:slug` handlers see the mount params.
User-path (ID-token) endpoints, each in **one** transaction that reads the project,
calls `assertWebEditable`, runs the matching `applyXUpsert(tx, …, "web")`, and stamps
`visionOwner: "web"`. They reuse the **existing zod schemas**:
- `PUT /:slug` — create/patch a web project (reuses `projectBody`). Mirror
  `upsertProject`'s create invariants via a split-out `applyProjectUpsert(tx, …)`
  helper: require the **team** doc to exist (`404` if not), and on create set
  `slug`, `createdAt`, `currentPhaseId: null`, `status` (default `"running"`), and
  `visionOwner: "web"`. Create is allowed when the project is absent; patch requires
  not-loop-owned (`assertWebEditable`).
- `PUT /:slug/goals/:goalId`, `PUT /:slug/scenarios/:scenarioId`,
  `PUT /:slug/documents/:docId` — guard + `applyXUpsert(tx, …, "web")`.
- `DELETE /:slug/goals/:goalId`, `DELETE /:slug/scenarios/:scenarioId`,
  `DELETE /:slug/documents/:docId` — new delete services (below).

Responses use the existing envelope (`{ ok: true }` / error `{ error: {code,message} }`).

### Delete services (`functions/src/services/*.ts` additions)

`deleteGoal`/`deleteScenario`/`deleteDocument(teamId, slug, id)` — one transaction:
read project, `assertWebEditable`, `tx.delete(docRef)`. (Deleting a scenario does not
cascade to its events; orphaned scores/testRuns are harmless and rare in web-authored
projects, which have no loop events. Documented.)

## Frontend

### Write client (`web/src/dashboard/api.ts`)

A small helper that calls the `/v1/u/...` endpoints with the user's ID token
(`auth.currentUser.getIdToken()`), mirroring the existing ID-token `Bearer` POST
templates in `web/src/keys/client.ts` / `web/src/admin/client.ts`. Exposes typed
`putGoal`/`deleteGoal`/`putScenario`/… returning `{ ok }` or throwing on non-2xx (with
the server error message for the UI).

**Project type:** add `visionOwner?: "web" | "loop"` to the dashboard `Project` type
(`web/src/dashboard/types.ts`). **Absence of the field means web-editable** — a
web-created project or a bare status board has no `visionOwner`, which is correct and
not a bug; only the explicit `"loop"` value makes the web read-only.

### Edit UI (`web/src/dashboard/components/edit/…`)

When the project is **web-owned** (`visionOwner !== "loop"`), the Vision section gains
inline controls; when **loop-owned**, it's the read-only #4 view (no controls):
- **Goal form** (title, description, order) — add/edit; delete button per goal.
- **Scenario form** (title, description, goal select, order, threshold, **rubric
  criteria editor** — add/remove rows of `{name, weight, max}` with a generated id) —
  add/edit; delete per scenario.
- **Document form** (kind, title, format, content) — add/edit; delete.
- A **"New project"** action (project slug + title → `PUT /:slug`) for web-first start.

Forms validate client-side to match the schemas (non-empty title, weight>0, max≥1,
threshold 0..100), submit via the write client, and rely on the live `onSnapshot`
subscriptions (#4) to reflect the change — no manual refetch.

## Validation / error handling

- Server: the existing zod bodies validate input (`400`); ownership conflict `409`;
  non-member `403`; not-allowed `403`; missing project `404`.
- Client: these are **interactive** actions (not best-effort) — surface server errors
  inline in the form (e.g. "this project is loop-owned and can't be edited here").

## Testing

- **Supertest** (`functions/test/userProjects.test.ts`): ID-token auth via a fake
  verifier (as existing `requireUser` tests do) + seeded membership; covers create
  project, goal/scenario/document upsert + delete, the **member guard (403)**, the
  **ownership guard (409 when loop-owned)**, and validation 400s.
- **Agent-ownership test**: an agent `upsertGoal`/`upsertScenario` stamps
  `visionOwner: "loop"`; a subsequent web write then 409s (loop-wins).
- **Rules**: unchanged; add a rules test asserting a client still cannot write
  goals/scenarios/documents directly (the recursive write-deny still holds) — i.e.
  the new path does not weaken rules.
- **Web**: form components render + submit (mocked write client): goal/scenario/
  document add+edit+delete; rubric-criteria editor add/remove; the edit controls are
  hidden when `visionOwner === "loop"`.
- `functions` + `web` build clean; existing suites stay green.

## Out of scope (deferred)

- `/daloop-loop` "pulling" a web-authored vision into a local `vision.json` (a future
  CLI enhancement; for now web-authored visions are consumed by readers, and a loop
  taking over simply overwrites).
- Real-time collaborative editing / conflict UI (single-editor assumption; last write
  wins within the web path).
- Reordering via drag-and-drop (use a numeric `order` field).
- Editing the loop-owned vision from the web (intentionally read-only).

## Success criteria

- A signed-in member can, in the browser, create a project and author a full vision
  (goals + scenarios with rubrics/thresholds + documents), edit and delete them, and
  see it render live via the #4 UI.
- All web writes go through `/v1/u/...` (ID token + membership), server-mediated;
  **Firestore rules are unchanged** and a direct client write still fails.
- A loop-driven (loop-owned) project is read-only in the web (no edit controls; the
  API returns `409` if a web write is attempted).
- Running a loop against a web-authored project takes ownership (subsequent web edits
  `409`).
- API (Supertest) + rules + web suites green; `functions` + `web` builds clean.
