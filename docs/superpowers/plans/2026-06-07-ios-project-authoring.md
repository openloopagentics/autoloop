# iOS Project Authoring (SP3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let users author project content on iOS — create/edit/delete Vision goals, scenarios, and documents on editable projects; create a project; delete a project (role-gated) — all via the existing REST API, building on SP2's project-detail.

**Architecture:** Add write methods to SP1's `RestClient`; port the web's pure id/slug/rubric logic with TDD; present forms as SwiftUI sheets that call those methods; the live Firestore listeners (SP2) reflect changes (no optimistic state). Mirrors `VisionEditableSection.tsx`, the `edit/*` forms, and `DashboardHome.tsx`.

**Tech Stack:** SwiftUI, iOS 16, Firebase, XCTest. Spec: `docs/superpowers/specs/2026-06-07-ios-project-authoring-design.md`.

## Conventions (every task)
- Repo root `/Users/ravikantcherukuri/.superset/worktrees/736423e6-7c9f-44b2-9949-bbd8a83e9e82/native-mobile-apps`; iOS at `ios/`. Branch `native-mobile-apps`.
- After adding files: `cd ios && xcodegen generate`. Simulator **`iPhone 16e`**. Build/test: `-destination 'platform=iOS Simulator,name=iPhone 16e'`. Build + XCTest only (no app run); keep suite green (currently 52). Commit per task; footer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Reuse SP1/SP2: `RestClient` (`url(_:_:_:)`, `authHeader()`, `check(_:_:)`, `putProject`, `postMessage`, `ApiError`), `ErrorNote`, `Spinner`, `ProjectDetailStore` (`editable`, `teamId`, `slug`, `goals`/`scenarios`/`documents` data), `DashboardStore`, models incl. `Goal/Scenario/RubricCriterion/DocumentRec`, `ProjectTask` (not `Task`).

---

## Task 1: RestClient write methods + body structs + tests (TDD on encoding)
**Files:** modify `ios/Autoloop/Data/RestClient.swift`; create `ios/Autoloop/Data/AuthoringBodies.swift`; `ios/AutoloopTests/AuthoringBodyTests.swift`.

- [ ] **Step 1:** Define `Encodable` body structs mirroring the web JSON (omit empty optionals):
  - `GoalBody { title: String; description: String?; order: Int? }`
  - `ScenarioBody { goalId: String?; title: String; description: String?; order: Int?; threshold: Int?; rubric: RubricBody }` where `RubricBody { criteria: [RubricCriterionBody] }`, `RubricCriterionBody { id, name: String; weight: Double; max: Double }`
  - `DocumentBody { kind: String; title: String; format: String; content: String }`
  Provide a `jsonObject` computed property (or use `JSONEncoder`) that drops nil optionals so the wire shape matches `api.ts`.
- [ ] **Step 2 (red):** `AuthoringBodyTests` — assert encoding omits nils and includes set fields, e.g. a `GoalBody(title:"T", description:nil, order:nil)` encodes to `{"title":"T"}`; a full `ScenarioBody` includes `rubric.criteria`. Run → FAIL.
- [ ] **Step 3 (green):** implement bodies. Add `RestClient` methods (mirror `api.ts`, using `url(teamId,slug,rest)` + a shared private `send(method:url:jsonBody:)`):
  - `putGoal(teamId:slug:id:body:GoalBody)`, `deleteGoal(teamId:slug:id:)`
  - `putScenario(teamId:slug:id:body:ScenarioBody)`, `deleteScenario(teamId:slug:id:)`
  - `putDocument(teamId:slug:id:body:DocumentBody)`, `deleteDocument(teamId:slug:id:)`
  - `deleteProject(teamId:slug:)`
  (DELETE = `send(method:"DELETE")` no body; PUT sends the encoded body.) Re-run → PASS.
- [ ] **Step 4:** build + full suite. Commit: `feat(ios): RestClient authoring writes + body encoders with tests`

## Task 2: Authoring pure logic (TDD)
**Files:** create `ios/Autoloop/Features/ProjectDetail/Authoring/AuthoringLogic.swift`; `ios/AutoloopTests/AuthoringLogicTests.swift`. Port from `VisionEditableSection.tsx` / `NewProjectForm.tsx` / `ScenarioForm.tsx`.

- [ ] **Step 1 (red):** tests:
```swift
func testSlugify() {
    XCTAssertEqual(slugify("Hello World!"), "hello-world")
    XCTAssertEqual(slugify("  A.B_c-d  "), "a.b_c-d")
}
func testGenIdDedupes() {
    XCTAssertEqual(genId(title: "Goal", taken: [], prefix: "g"), "goal")
    XCTAssertEqual(genId(title: "Goal", taken: ["goal"], prefix: "g"), "goal-2")
    XCTAssertEqual(genId(title: "", taken: ["g"], prefix: "g"), "g-2")
}
func testIsValidSlug() {
    XCTAssertTrue(isValidSlug("web-1.0_x")); XCTAssertFalse(isValidSlug("Web Site"))
    XCTAssertFalse(isValidSlug(""))
}
func testBuildRubricCriteria() {
    let rows = [CriterionRow(name: "Speed", weight: "2", max: "5"),
                CriterionRow(name: "Speed", weight: "1", max: "5")]   // dup name → unique ids
    let c = buildRubricCriteria(rows)
    XCTAssertEqual(c.count, 2); XCTAssertNotEqual(c[0].id, c[1].id)
    XCTAssertEqual(c[0].name, "Speed"); XCTAssertEqual(c[0].weight, 2)
}
func testRubricRowValidity() {
    XCTAssertTrue(rowIsValid(CriterionRow(name:"n", weight:"1", max:"5")))
    XCTAssertFalse(rowIsValid(CriterionRow(name:"", weight:"1", max:"5")))
    XCTAssertFalse(rowIsValid(CriterionRow(name:"n", weight:"0", max:"5")))
    XCTAssertFalse(rowIsValid(CriterionRow(name:"n", weight:"1", max:"0")))
}
```
Run → FAIL.
- [ ] **Step 2 (green):** implement `slugify`, `genId(title:taken:prefix:)`, `isValidSlug` (`^[a-z0-9._-]+$` on trimmed), `CriterionRow {name,weight,max: String}`, `rowIsValid` (name non-empty, weight>0, integer max≥1), `buildRubricCriteria(_:)->[RubricCriterion]` (id = slugified name or `c{i+1}`, de-dup). Re-run → PASS.
- [ ] **Step 3:** build + full suite. Commit: `feat(ios): authoring id/slug/rubric logic with tests`

## Task 3: Vision editing UI
**Files:** create under `ios/Autoloop/Features/ProjectDetail/Authoring/`: `GoalFormView.swift`, `ScenarioFormView.swift`, `DocumentFormView.swift`; modify `Tabs/VisionTabView.swift`. Mirror the web `edit/*` forms + `VisionEditableSection.tsx`.

- [ ] **Step 1:** Form views (each a sheet body with its fields, validation mirroring the web, a Save button disabled until valid, inline `ErrorNote` on failure, async save closure):
  - `GoalFormView(initial: Goal?, onSave: (GoalBody) async throws -> Void)`
  - `ScenarioFormView(initial: Scenario?, goals: [Goal], onSave: (ScenarioBody) async throws -> Void)` — includes the rubric criteria editor (add/remove rows via `CriterionRow`, `rowIsValid`, `buildRubricCriteria`), goal picker ("(no goal)" + goals), threshold 0–100.
  - `DocumentFormView(initial: DocumentRec?, onSave: (DocumentBody) async throws -> Void)` — kind, title, format (markdown|url) picker, content (TextEditor), ≤100 KB guard.
- [ ] **Step 2:** In `VisionTabView`, when `store.editable`: add an "Add goal/scenario/document" affordance (e.g. a menu or buttons) presenting the right form sheet; give each rendered goal/scenario/document an edit (sheet, pre-filled with `initial`) and delete (confirmationDialog) control. Wire:
  - create: `id = genId(title:..., taken: <existing ids>, prefix:)`, then `RestClient.put…`.
  - edit: keep existing id, `RestClient.put…`.
  - delete: `RestClient.delete…`.
  The live listeners refresh the lists. Non-editable projects render the SP2 read-only Vision unchanged.
- [ ] **Step 3:** build → SUCCEEDED, suite green. Commit: `feat(ios): Vision editing — goal/scenario/document create/edit/delete`

## Task 4: Project create (Dashboard)
**Files:** create `ios/Autoloop/Features/Dashboard/NewProjectFormView.swift`; modify `DashboardView.swift` and `DashboardStore.swift`. Mirror `NewProjectForm.tsx` + `DashboardHome.tsx` create.

- [ ] **Step 1:** Ensure `DashboardStore` exposes the user's teams (with ids) for the picker — it already listens to `collectionGroup("members")`; expose the `[TeamRef]` (teamId + role) it derives (add a `@Published teams: [TeamRef]` if not present).
- [ ] **Step 2:** `NewProjectFormView(teams: [TeamRef], onCreate: (teamId,slug,title) async throws -> Void)`: team picker, slug field (validate with `isValidSlug`, show the a-z0-9._- hint), title; Save disabled until valid.
- [ ] **Step 3:** Add a "+" toolbar button on `DashboardView` (shown when teams non-empty) presenting the sheet; `onCreate` calls `RestClient.putProject(teamId:slug:title:)` then dismisses and navigates to `ProjectDetailView(teamId:slug:)` (push). Live listener shows it too.
- [ ] **Step 4:** build → SUCCEEDED, suite green. Commit: `feat(ios): create project from Dashboard`

## Task 5: Project delete (Dashboard, role-gated)
**Files:** modify `DashboardView.swift`, `DashboardStore.swift`. Mirror `DashboardHome.tsx` delete.

- [ ] **Step 1:** `DashboardStore`: expose role per team — a `func role(forTeam:String) -> String?` (or `[teamId: role]` map) built from the `TeamRef` list. `canDelete(teamId) = role == "owner" || role == "manager"`.
- [ ] **Step 2:** On each project row, when `canDelete(row.teamId)`, add a delete action (swipe action or context menu). Tapping shows a `confirmationDialog` ("Delete project \"<slug>\"? This cannot be undone."); confirm → `RestClient.deleteProject(teamId:slug:)`; on error show an alert/inline `ErrorNote`. The listener removes the row live.
- [ ] **Step 3:** build → SUCCEEDED, suite green. Commit: `feat(ios): delete project from Dashboard (role-gated)`

## Task 6: Verify + manual acceptance
- [ ] **Step 1:** clean `xcodegen generate && xcodebuild test` → all green (52 + new tests). Quote total.
- [ ] **Step 2:** manual acceptance (needs secrets): on an editable project add/edit/delete a goal, a scenario (with rubric rows), a document; create a project from the Dashboard; delete a project as owner/manager; confirm non-editable projects show no editing and non-owner/manager see no delete. Record results.

## Done criteria
- `xcodebuild test` green (new: body-encoding + authoring-logic tests).
- Vision CRUD, project create, role-gated project delete all wired to the REST API; non-editable/permission cases correctly hidden; no backend change.
