# Autoloop iOS — SP3a Project Authoring (vision editing + project create/delete) — Design

**Date:** 2026-06-07
**Status:** Approved (design phase — autonomous; spec-reviewer + code-reviewer as quality gates)

## Context

SP1 (skeleton) and SP2 (read surfaces) are built (PR #67, 52 tests). SP2's
project-detail already exposes `ProjectDetailStore.editable` (project
`visionOwner != "loop"`) and renders the read-only Vision tab. SP3 (write
surfaces) is large, so it is split:

- **SP3a (this spec):** project *authoring* — Vision editing (goals/scenarios/
  documents create/edit/delete), project create, project delete. Lives in the
  existing project-detail + Dashboard, building directly on SP2.
- **SP3b (later):** account & admin screens — Teams, Keys, Admin (the three
  placeholder tabs).

Mirrors the web's `VisionEditableSection.tsx`, the edit forms under
`web/src/dashboard/components/edit/`, `DangerZone.tsx`, and `api.ts`. No backend
change — these call the existing Cloud Functions REST API.

## Scope

In: per the web `api.ts` — `putGoal/deleteGoal`, `putScenario/deleteScenario`,
`putDocument/deleteDocument`, project create (`putProject` with a new slug), and
`deleteProject`. Messages compose already shipped in SP2.

Out (SP3b/later): teams, keys, admin; loop/phase/task/score/test-run authoring
(those are agent-written, not user-edited).

## REST client additions

Extend `RestClient` (SP1) using its existing `url(teamId, slug, rest)`,
`authHeader()`, `check(_:_:)` helpers. Add a private `send(_ method:url:body:)`
to DRY the PUT/DELETE/POST bodies. New methods mirroring `api.ts`:

- `putGoal(teamId:slug:id:body:)`, `deleteGoal(teamId:slug:id:)`
- `putScenario(teamId:slug:id:body:)`, `deleteScenario(teamId:slug:id:)`
- `putDocument(teamId:slug:id:body:)`, `deleteDocument(teamId:slug:id:)`
- `deleteProject(teamId:slug:)`
- (create reuses the existing `putProject(teamId:slug:title:status:)`)

Bodies are built from typed Swift structs encoded to JSON (`GoalBody`,
`ScenarioBody` with nested `rubric.criteria`, `DocumentBody`), matching the JSON
shapes the API expects (see the web forms). PUT bodies omit empty optionals like
the web does.

## Pure logic (TDD)

Port from `VisionEditableSection.tsx` / forms:
- `slugify(_ String) -> String` (lowercase, non-`[a-z0-9._-]`→`-`, trim dashes).
- `genId(title:taken:prefix:) -> String` (slug, else prefix; de-dupe with `-2`,
  `-3`, …).
- `isValidSlug(_ String) -> Bool` (`^[a-z0-9._-]+$`) for project create.
- `buildRubricCriteria(rows:) -> [RubricCriterion]` (id from slugified name, weight
  > 0, integer max ≥ 1; de-dupe ids) and the form's validity predicate.

These are platform-agnostic and unit-tested against the same cases as the web.

## UI

### Vision editing (in `VisionTabView`, gated by `store.editable`)
Mirror `VisionEditableSection.tsx`. When editable:
- "Add goal / Add scenario / Add document" buttons open a **sheet** with the
  corresponding form (`GoalFormView`, `ScenarioFormView`, `DocumentFormView`).
- Each existing goal/scenario/document gets **edit** (sheet, pre-filled) and
  **delete** (confirm) affordances.
- New ids are generated with `genId` over the current ids (goals/scenarios/
  documents); edits keep the existing id (PUT is an idempotent upsert).
- Forms mirror the web fields/validation:
  - GoalForm: title (required), description?, order?.
  - ScenarioForm: title (required), description?, goal picker, order?, threshold
    0–100?, and a **rubric criteria editor** (rows of name/weight/max, add/remove,
    ≥1 valid row required).
  - DocumentForm: kind (required), title (required), format (markdown|url), content
    (required, ≤100 KB).
- Save calls the matching `RestClient` method; the live Firestore listener
  reflects the change (no optimistic update). Errors show inline in the sheet.

### Project create (from Dashboard)
A "+" toolbar button on `DashboardView` opens a sheet with `NewProjectFormView`
(mirror `NewProjectForm.tsx`): team picker (from the user's teams — reuse
`DashboardStore`'s team list), slug (validated by `isValidSlug`), title. Calls
`RestClient.putProject(teamId:slug:title:)` (create = upsert with a fresh slug).
The Dashboard listener shows the new project live.

### Project delete (from the Dashboard — mirrors the real web UX)
The live web deletes projects from `DashboardHome.tsx`, NOT via the unused
`DangerZone.tsx` (which is dead code). Mirror the real flow:
- A per-project delete action on the Dashboard (a swipe action / context menu on
  the project row), shown only when the user's role on that project's team is
  `owner` or `manager`.
- Confirm with a simple iOS confirmation dialog ("Delete project \"<slug>\"? This
  cannot be undone."), then call `RestClient.deleteProject(teamId:slug:)`. The
  Dashboard listener removes the row live; an API error surfaces inline (the
  server also enforces authz).
- **Role source:** reuse the team list `DashboardStore` already builds from the
  `collectionGroup("members")` query (the analogue of `useMyTeams`) — each
  `TeamRef` carries `role`. Expose role per team on `DashboardStore` (e.g. a
  `[teamId: role]` map or `role(forTeam:)`); do NOT add a new
  `teams/{teamId}/members/{uid}` read.

(There is no project-detail toolbar delete and no type-the-slug step — those would
diverge from the web. Delete lives on the Dashboard, like the web.)

## Error handling

All writes throw the SP1 `ApiError` carrying the server `{error:{message}}`; forms
and confirm dialogs render it inline (reusing `ErrorNote`). No optimistic state —
the Firestore listeners are the source of truth, so a successful write simply
appears. A failed delete keeps the user on the screen with the error shown.

## Testing

- **Unit (XCTest):** `slugify`, `genId`, `isValidSlug`, `buildRubricCriteria` +
  the scenario-form validity predicate (port the web cases). Body-encoding tests
  for `ScenarioBody`/`GoalBody`/`DocumentBody` → expected JSON dict (omitted
  optionals).
- **Build + manual acceptance** (needs the SP1/SP2 secrets): on an editable
  project, add/edit/delete a goal, a scenario (with rubric), a document; create a
  new project from the Dashboard; delete a project from the Dashboard via the
  confirm dialog as an owner/manager. Verify non-editable projects
  (`visionOwner == "loop"`) show no editing UI, and members (non-owner/manager)
  see no delete action.

## Out of scope (later)

Teams / Keys / Admin (SP3b); FCM push (SP4); Android (SP5).
