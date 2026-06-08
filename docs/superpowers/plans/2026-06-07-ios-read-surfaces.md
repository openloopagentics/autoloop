# iOS Read Surfaces (SP2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the iOS project-detail screen fully live — a native mirror of the web's `ProjectDetail.tsx` and its six tabs (Dashboard/Vision/Loops/Tests/Bugs/Messages), driven by Firestore real-time listeners, with one write (Messages compose).

**Architecture:** Thin SwiftUI client reusing SP1's data layer (`QueryListener`, `RestClient`, Firestore dict decoders) and pure-logic ports (`buildLoopList`/`defaultSelectedLoop`/`loopArgFor`/`effectiveProjectStatus`/`deriveScenarioState`/`summarize`/`latestById`/`phaseProgress`/`basePath`). A `ProjectDetailStore` owns project-level data + loop selection; each tab has its own store subscribing on appear. Full Firestore models feed the SP1 pure functions through small `…Rec` mapper structs, so no domain code changes.

**Tech Stack:** Swift 5.9+/6.2, SwiftUI, iOS 16, Firebase iOS SDK, **swift-markdown-ui** (new SPM dep), XcodeGen, XCTest.

**Spec:** `docs/superpowers/specs/2026-06-07-ios-read-surfaces-design.md`

---

## Environment / conventions (every task)

- Work from repo root: `/Users/ravikantcherukuri/.superset/worktrees/736423e6-7c9f-44b2-9949-bbd8a83e9e82/native-mobile-apps`; iOS project under `ios/`.
- Branch `native-mobile-apps` (do not switch). After adding/removing files or editing `project.yml`: `cd ios && xcodegen generate` (sources are folder-globbed; `.xcodeproj` is gitignored).
- Simulator: **`iPhone 16e`** (no "iPhone 15"). Build/test destination: `-destination 'platform=iOS Simulator,name=iPhone 16e'`.
- No real `GoogleService-Info.plist` → **build + XCTest verification only**; do not run the app. Tests must stay green (SP1 left 25 passing; each task reports the new total).
- Commit per task; commit-message footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Fidelity:** UI tasks mirror named files under `web/src/dashboard/`. Read them for exact layout/labels; match content and behavior, adapt idiom to SwiftUI (no need to match CSS pixel-for-pixel).
- **Reuse, don't duplicate:** SP1 already defines `Project/Team/TeamRef`, `statusColor`, `StatusBadge`, `Spinner`, `ErrorNote`, `EmptyState`, `QueryListener`, `Loadable`, `RestClient`, and the domain `…Rec` structs (`LoopRec/ProjectRec/PhaseRec/StatusLoop/ScenarioRec/ScoreRec/TestRunRec/IdItem`) + pure functions. Do not redefine them.

## File structure (new)

```
ios/Autoloop/
  Data/
    Models.swift            # EXTEND with the new models
    Listeners.swift         # NEW: project/loop-scoped/all-scope/lazy listener helpers
    RecBridge.swift         # NEW: full model -> SP1 …Rec mappers
  Features/ProjectDetail/
    ProjectDetailStore.swift
    ProjectDetailView.swift          # header + swipe pager + tappable strip + loop picker
    LoopPicker.swift
    Tabs/
      DashboardTabView.swift + DashboardTabStore.swift
      VisionTabView.swift   + VisionTabStore.swift
      LoopsTabView.swift    + LoopsTabStore.swift
      TestsTabView.swift    + TestsTabStore.swift  (+ TestsLogic.swift, pure)
      BugsTabView.swift     + BugsTabStore.swift
      MessagesTabView.swift + MessagesTabStore.swift
    Components/             # RollupStrip, LoopSnapshot, ScenarioCard, BugRow, MessageBubble,
                            # TestRunDisclosure, PlanSection, RevisionTimeline, MarkdownView, ...
  AutoloopTests/
    ModelsDecodeTests.swift # EXTEND
    RecBridgeTests.swift    # NEW
    TestsLogicTests.swift   # NEW
```

---

## Task 1: Add swift-markdown-ui dependency + MarkdownView

**Files:** Modify `ios/project.yml`; Create `ios/Autoloop/Features/ProjectDetail/Components/MarkdownView.swift`.

- [ ] **Step 1:** In `project.yml` under `packages:` add:
```yaml
  MarkdownUI:
    url: https://github.com/gonzalezreal/swift-markdown-ui
    from: 2.4.0
```
and under `targets.Autoloop.dependencies` add:
```yaml
      - package: MarkdownUI
        product: MarkdownUI
```
- [ ] **Step 2:** Create `MarkdownView.swift`:
```swift
import SwiftUI
import MarkdownUI

/// Renders Markdown content (Vision documents / design docs). Wraps swift-markdown-ui
/// so the rest of the app depends on one small surface.
struct MarkdownView: View {
    let text: String
    var body: some View { Markdown(text) }
}
```
- [ ] **Step 3:** `cd ios && xcodegen generate && xcodebuild build -project Autoloop.xcodeproj -scheme Autoloop -destination 'platform=iOS Simulator,name=iPhone 16e'` → quote `** BUILD SUCCEEDED **` (first resolve downloads the package).
- [ ] **Step 4:** Commit: `feat(ios): add swift-markdown-ui + MarkdownView wrapper`

---

## Task 2: New Firestore models + decoder tests (TDD)

Mirror `web/src/dashboard/types.ts`. Extend `Data/Models.swift`; extend `AutoloopTests/ModelsDecodeTests.swift`.

Models to add (all use the SP1 `init(id:data:)` typed-accessor pattern; `Identifiable` where they have ids; use `.date()` for Firestore `Timestamp` fields; tolerate missing/loose fields):

- `Loop` { id, goal?, name?, order?, status?, startedAt?:Date, endedAt?:Date, currentPhaseId?, currentTaskId? }
- `Phase` { id, name?, order?, status?, startedAt?:Date, endedAt?:Date }
- `CommitTokens` { input, output, cacheRead, cacheWrite, total } (Ints, default 0) ; `Commit` { sha(id), message?, author?, committedAt?:Date, tokens?:CommitTokens }
- `RubricCriterion` { id, name, weight, max } ; `Goal` { id, title?, description?, order? }
- `Scenario` { id, goalId?, title?, description?, order?, threshold?:Int, rubric?:[RubricCriterion] }
- `Task` { id, phaseId?, title?, order?, status?, scenarioIds?:[String] }
- `Score` { id, scenarioId?, taskId?, criteria?:[String:Double], composite?:Double, by?, note?, commitSha? }
- `TestRun` { id, scenarioId?, taskId?, passed?:Int, failed?:Int, issues?:[String], summary?, loopId? }
- `RevisionChange` { op, taskId, … } (keep raw extras in a `[String:Any]`-free way: store `op`, `taskId` only) ; `Revision` { id, triggerScenarioId?, triggerReason?, changes?:[RevisionChange] }
- `DocumentRec` { id, kind?, title?, format?("markdown"|"url"), content? }
- `Bug` { id, title?, description?, scenarioId?, taskId?, severity?("low"|"medium"|"high"), status?("open"|"fixed"), createdAt?:Date, updatedAt?:Date, fixedAt?:Date, loopId? }
- `Message` { id, text, author("user"|"agent"), status?("pending"|"delivered"), createdAt?:Date, deliveredAt?:Date }
- `SessionEntry` (enum: `.user(text,ts)`, `.assistant(text,ts)`, `.tool(name,summary,ok,ts)`) ; `SessionDoc` { sessionId(id), startedAt:Double, endedAt:Double, entries:[SessionEntry] }

For nested arrays (rubric criteria, revision changes, session entries) decode from `[[String:Any]]` via `(data["x"] as? [[String:Any]])?.map { … }`. For `Score.criteria` decode `[String: Double]` from `[String:Any]` mapping NSNumber→Double. `SessionEntry.kind` switches on `data.str("kind")`.

- [ ] **Step 1 (red):** Add focused decode tests to `ModelsDecodeTests.swift` for the tricky ones, e.g.:
```swift
func testScenarioDecodesRubricAndThreshold() {
    let s = Scenario(id: "s1", data: ["title": "T", "threshold": 70,
        "rubric": ["criteria": [["id":"c1","name":"n","weight":1,"max":5]]]])
    XCTAssertEqual(s.threshold, 70)
    XCTAssertEqual(s.rubric?.first?.name, "n")
}
func testTestRunDecodesCountsAndIssues() {
    let r = TestRun(id: "01", data: ["passed": 3, "failed": 1, "issues": ["a","b"], "scenarioId":"s1"])
    XCTAssertEqual(r.passed, 3); XCTAssertEqual(r.failed, 1); XCTAssertEqual(r.issues?.count, 2)
}
func testSessionEntryToolDecode() {
    let d = SessionDoc(id: "S1", data: ["startedAt": 1.0, "endedAt": 2.0,
        "entries": [["kind":"tool","name":"Bash","summary":"ls","ok":true,"ts":1]]])
    guard case .tool(let name, _, let ok, _)? = d.entries.first else { return XCTFail() }
    XCTAssertEqual(name, "Bash"); XCTAssertTrue(ok)
}
func testBugDecodeMinimal() {
    let b = Bug(id: "b1", data: ["title":"x","severity":"high","status":"open"])
    XCTAssertEqual(b.severity, "high"); XCTAssertEqual(b.status, "open")
}
```
Run `-only-testing:AutoloopTests/ModelsDecodeTests` → FAIL (types undefined).
- [ ] **Step 2 (green):** Implement the models in `Models.swift`. Re-run → PASS.
- [ ] **Step 3:** Full suite (expect 25 + new). Commit: `feat(ios): Firestore models for project-detail with decoder tests`

> Note on `Scenario.rubric`: the web type nests `rubric: { criteria: [...] }`. Decode the inner `criteria` array; expose `rubric: [RubricCriterion]?` directly (flatten the wrapper).

---

## Task 3: Listener helpers (project-level, loop-scoped, lazy)

Create `Data/Listeners.swift`. Mirror `web/src/dashboard/hooks.ts`. These are small `@MainActor` `ObservableObject`s OR functions returning a started `QueryListener` — pick the pattern that fits the stores cleanly; recommended: a generic `CollectionStore<T>` built on `QueryListener` that each tab store composes. Build-verified (no new unit tests; logic is the generic listener already tested by usage).

Provide collection listeners (each ordered by document id, mapping snapshot docs → model via `init(id:data:)`):
- Project-level: `loops` (`teams/{t}/projects/{s}/loops`), `goals`, `scenarios`, `documents`, `messages`.
- Loop-scoped via `basePath(teamId:slug:loopId:)` + collection name: `phases`, `tasks`, `scores`, `testRuns`, `revisions`. (`loopId == nil` → project-direct path, exactly as `basePath` already handles.)
- `sessionLog`: loop-scoped `sessions` collection → `[SessionDoc]`.
- Lazy (created on demand by Loops detail): `commits(phaseId:loopId:)` and `taskCommits(taskId:loopId:)` — these query `…/phases/{phaseId}/commits` and a `commits` collection filtered by `taskId` respectively; read `hooks.ts` `useCommits`/`useTaskCommits` for exact paths/filters.

- [ ] **Step 1:** Implement a reusable `CollectionStore<T>` (start/stop, `@Published data/loading/error`) wrapping `QueryListener`, plus thin factory helpers building the right `Query` for each collection above.
- [ ] **Step 2:** Build → `** BUILD SUCCEEDED **`.
- [ ] **Step 3:** Commit: `feat(ios): Firestore collection listeners for project-detail`

---

## Task 4: All-scope merge (fan-out) — pure logic (TDD) + listeners

Mirror `useAllTestRuns/useAllScores/useAllBugs` in `hooks.ts`: **NOT** a collectionGroup query — fan out one listener per scope (project-direct + each loop id), stamp `loopId` on each doc, merge, and filter to currently-present scopes (so a removed loop's docs drop). Extract the merge/filter as a pure function and unit-test it; the listener wiring is build-verified.

Create `Data/AllScopeMerge.swift` (pure) + an `AllScopeStore<T>` in `Listeners.swift`. Test in `AutoloopTests/RecBridgeTests.swift` or a new file.

- [ ] **Step 1 (red):** Test the pure merge:
```swift
// mergeScopes(byScope:, currentScopeKeys:) -> [T]  (flatten only current scopes)
func testMergeDropsRemovedScopes() {
    let by = ["__main__": [1], "L1": [2], "L2": [3]]
    let out = mergeScopes(byScope: by, current: ["__main__", "L1"]).sorted()
    XCTAssertEqual(out, [1, 2])           // L2 dropped
}
```
Run → FAIL.
- [ ] **Step 2 (green):** Implement `mergeScopes` (generic) + `AllScopeStore<T>` that: derives scope keys from the current `loops` (`"__main__"` + each loop id), starts/stops one `QueryListener` per scope, stamps `loopId`, stores `byScope`, and republishes `mergeScopes(...)` on every change; on loop-set change it adds/removes per-scope listeners. Re-run → PASS.
- [ ] **Step 3:** Build + full suite. Commit: `feat(ios): all-scope fan-out merge for bugs/scores/testRuns with tests`

---

## Task 5: Rec bridge mappers (TDD)

Create `Data/RecBridge.swift` + `AutoloopTests/RecBridgeTests.swift`. Map full models → the SP1 `…Rec` inputs so the pure functions are reused unchanged.

- [ ] **Step 1 (red):** Tests:
```swift
func testLoopToRecAndStatusLoop() {
    let l = Loop(id: "L1", data: ["goal":"g","status":"running","order":2])
    XCTAssertEqual(l.asLoopRec.status, "running")
    XCTAssertEqual(l.asStatusLoop.order, 2)
}
func testScenarioScoreTestRunRecs() {
    XCTAssertEqual(Scenario(id:"s1", data:["threshold":70]).asRec.threshold, 70)
    XCTAssertEqual(Score(id:"01", data:["scenarioId":"s1","composite":88]).asRec.composite, 88)
    XCTAssertEqual(TestRun(id:"01", data:["scenarioId":"s1","failed":0]).asRec.failed, 0)
}
```
Run → FAIL.
- [ ] **Step 2 (green):** Add computed-property mappers: `Loop.asLoopRec`, `Loop.asStatusLoop`, `Project.asProjectRec`, `Phase.asPhaseRec`, `Scenario.asRec` (→`ScenarioRec`), `Score.asRec` (→`ScoreRec`), `TestRun.asRec` (→`TestRunRec`). Re-run → PASS.
- [ ] **Step 3:** Build + full suite. Commit: `feat(ios): model→Rec bridge mappers with tests`

---

## Task 6: ProjectDetailStore + loop selection

Create `Features/ProjectDetail/ProjectDetailStore.swift`. Mirrors the project-level orchestration in `ProjectDetail.tsx`.

`@MainActor final class ProjectDetailStore: ObservableObject` holding: `teamId`, `slug`; child collection stores for `project`(doc), `loops`, `goals`, `scenarios`, `documents`; `@Published selectedId: String` (user pick) and computed:
- `loopList: [SelectableLoop]` = `buildLoopList(loops.map(\.asLoopRec), project: project?.asProjectRec, hasProjectDirectData: <directPhases or directTasks nonempty>)`. (Subscribe to project-direct `phases`/`tasks` to detect legacy data, as `ProjectDetail.tsx` does.)
- `effectiveStatus` = `effectiveProjectStatus(loops.map(\.asStatusLoop), projectStatus: project?.status)`
- `resolvedSelectedId` = picked-if-valid else `defaultSelectedLoop(loopList, currentLoopId: project?.currentLoopId)`
- `selectedLoop` = loopList.first{ id == resolvedSelectedId }; `loopArg` = `loopArgFor(selectedLoop)`
- `agentActive` = any loop running, or (no loops && project.status == "running")
- `editable` = project != nil && project.visionOwner != "loop" (add `visionOwner` to `Project` model if absent — check SP1's `Project`; extend it if needed)

`start()`/`stop()` fan child stores. Build-verified (selection logic is exercised by the already-tested pure functions; optionally add one store-level test if straightforward).

- [ ] **Step 1:** Implement the store. If `Project` lacks `visionOwner`/`currentLoopId`/`design`, extend the SP1 `Project` model (and add a quick decode test).
- [ ] **Step 2:** Build → SUCCEEDED; full suite green.
- [ ] **Step 3:** Commit: `feat(ios): ProjectDetailStore with loop selection + effective status`

---

## Task 7: ProjectDetailView shell + navigation from Dashboard

Create `ProjectDetailView.swift`, `LoopPicker.swift`, and a `ProjectHeaderView` + `ProjectDetailTab` enum. Wire navigation: tapping a row in SP1's `DashboardView` pushes `ProjectDetailView(teamId:slug:)`.

- [ ] **Step 1:** `ProjectDetailTab` enum (`dashboard/vision/loops/tests/bugs/messages`) with `title`. Mirror `components/Tabs.tsx` order/labels.
- [ ] **Step 2:** `ProjectDetailView`: `@StateObject ProjectDetailStore`; layout = `ProjectHeaderView` (mirror `ProjectHeader.tsx`: title, slug chip, status badge, design doc link/markdown) + a **tappable scrollable strip** (segmented control of tabs) bound to a `@State selection` + a **`TabView(selection:).tabViewStyle(.page(indexDisplayMode: .never))`** swipe pager whose pages are the six tab views. Tapping the strip sets `selection`; swiping updates it (two-way). Include the `LoopPicker` (only when `loopList.count > 1`) near the header, bound to `store.selectedId`.
- [ ] **Step 3:** `LoopPicker` mirrors `LoopSelector.tsx` (`main (legacy)` label for the synthesized main; `name ?? goal ?? id`, plus ` — status`). Use a SwiftUI `Picker`/`Menu`.
- [ ] **Step 4:** In `DashboardView` (SP1), wrap rows in `NavigationLink(value:)` or push `ProjectDetailView` on tap (use the existing `NavigationStack`). Each tab page body is a placeholder `Text(tab.title)` for now — real tab views land in Tasks 8–13.
- [ ] **Step 5:** Build → SUCCEEDED. Commit: `feat(ios): project-detail shell — header, swipe pager + strip, loop picker, nav`

---

## Task 8: Dashboard tab

Create `Tabs/DashboardTabView.swift` + `DashboardTabStore.swift`; components `RollupStrip`, `LoopSnapshot`. Mirror `tabs/DashboardTab.tsx`, `components/RollupStrip.tsx`, `components/LoopSnapshot.tsx`.

- `DashboardTabStore` subscribes (loop-scoped, by `store.loopArg`) to `phases/tasks/scores/testRuns`; re-subscribes when `loopArg` changes.
- `RollupStrip`: counts `loops` total + running (`loopIsRunning`) + status badge.
- `LoopSnapshot`: `phaseProgress(phases.map(\.asPhaseRec))`, `summarize(scenarios.map(\.asRec), scores.map(\.asRec), testRuns.map(\.asRec))`, current task by `selectedLoop.currentTaskId`.

- [ ] Implement; first-load spinner uses `loading && data.isEmpty`. Build → SUCCEEDED. Commit: `feat(ios): Dashboard tab (rollup + loop snapshot)`

---

## Task 9: Vision tab

Create `Tabs/VisionTabView.swift` + `VisionTabStore.swift`; components `ScenariosMetBanner`, `ScenarioCard`, `DocumentsSection`. Mirror `tabs/VisionTab.tsx` (read-only branch), `components/VisionSection.tsx`, `ScenarioTable.tsx`→`ScenarioCard.tsx`, `DocumentsSection.tsx`, `ScenariosMetBanner.tsx`.

- Uses `store.goals/scenarios/documents` + `allScores`/`allTestRuns` (Task 4 stores) — met-state spans all loops.
- Banner: `summarize(...)` met/total. Scenarios grouped by goal (+ "Ungrouped" for orphans). `ScenarioCard`: `deriveScenarioState`, composite vs threshold bar, latest test counts, score history disclosure.
- Documents: `format == "url"` → titled link + url; else → `MarkdownView(text: content)`. (Design doc on the header likewise renders markdown.)
- SP2 is read-only: render the `VisionSection` (non-editable) branch only.

- [ ] Implement. Build → SUCCEEDED. Commit: `feat(ios): Vision tab (scenarios met, goals/scenarios, documents as markdown)`

---

## Task 10: Loops tab

Create `Tabs/LoopsTabView.swift` + `LoopsTabStore.swift`; components `LoopRow`, `LoopDetail` (→ `PlanSection`, `TestRunsSection`, `RevisionTimeline`, `PhaseItem`, `TaskItem`, `CommitItem`). Mirror `tabs/LoopsTab.tsx`, `components/LoopList.tsx`, `LoopDetail.tsx`, `PlanSection.tsx`, `TestRunsSection.tsx`, `RevisionTimeline.tsx`, `PhaseItem.tsx`, `TaskItem.tsx`, `CommitItem.tsx`.

- Loop list: each row shows progress (`phaseProgress`) + scenarios met (`summarize`) per loop — note the web subscribes per-row to that loop's phases/scores/testRuns (`LoopList.tsx` `LoopRowContainer`). Port that per-row subscription (each row owns a small store keyed by its loop arg), OR compute lazily on selection to limit listeners — implementer's call; document the choice.
- Selecting a loop expands `LoopDetail` inline: `PlanSection` (phases→tasks, current task highlighted, commits per task/phase via lazy `commits`/`taskCommits`), `TestRunsSection`, `RevisionTimeline`.
- Selecting a loop in this tab also updates `store.selectedId` (shared selection with Dashboard).

- [ ] Implement. Build → SUCCEEDED. Commit: `feat(ios): Loops tab (loop list + plan/test-runs/revisions detail)`

---

## Task 11: Tests tab (+ pure helper, TDD)

Create `Tabs/TestsTabView.swift` + `TestsTabStore.swift` + `Tabs/TestsLogic.swift` (pure) + `AutoloopTests/TestsLogicTests.swift`. Mirror `tabs/TestsTab.tsx`.

The pure logic to extract & test (from `TestsTab.tsx`): given `scenarios` + `testRuns`, produce the ordered display list = tested scenarios, then **extra scenario ids that appear only in runs** (not in the vision), then untested scenarios; plus per-scenario `latest run` (max id) and pass/fail/none state.

- [ ] **Step 1 (red):** Tests:
```swift
func testExtraScenariosFromRunsAppear() {
    let scns = [TScn(id:"s1")]
    let runs = [TRun(id:"01", scenarioId:"s1", passed:1, failed:0),
                TRun(id:"02", scenarioId:"x9", passed:0, failed:1)]   // x9 not in vision
    let groups = buildTestGroups(scenarios: scns, runs: runs)
    XCTAssertEqual(groups.map(\.scenarioId), ["s1", "x9"])  // tested, then extra
    XCTAssertEqual(groups[0].state, .pass)
    XCTAssertEqual(groups[1].state, .fail)
}
func testUntestedLast() {
    let groups = buildTestGroups(scenarios: [TScn(id:"a"), TScn(id:"b")],
                                 runs: [TRun(id:"01", scenarioId:"a", passed:1, failed:0)])
    XCTAssertEqual(groups.map(\.scenarioId), ["a","b"])
    XCTAssertEqual(groups[1].state, .none)
}
```
(Use small local input structs or reuse `Scenario`/`TestRun`.) Run → FAIL.
- [ ] **Step 2 (green):** Implement `buildTestGroups` + state enum (`pass`/`fail`/`none`: pass = latest failed==0 && passed>0). Re-run → PASS.
- [ ] **Step 3:** `TestsTabView`: per-scenario disclosure rows (badge `passed/total ✓/✗`, run history with summary + issues), using `allTestRuns` + `scenarios`. Build + full suite. Commit: `feat(ios): Tests tab with grouping logic + tests`

---

## Task 12: Bugs tab

Create `Tabs/BugsTabView.swift` + `BugsTabStore.swift` + `Components/BugRow.swift`. Mirror `tabs/BugsTab.tsx`, `components/BugsList.tsx`, `BugItem.tsx`.

- Uses `allBugs` (Task 4). Order: open first (`status != "fixed"`), then fixed. Empty → "No bugs reported." `BugRow`: title, severity chip, status, description, scenario/task refs.

- [ ] Implement. Build → SUCCEEDED. Commit: `feat(ios): Bugs tab (open-then-fixed list)`

---

## Task 13: Messages tab (thread + compose + Session Log)

Create `Tabs/MessagesTabView.swift` + `MessagesTabStore.swift` + `Components/MessageBubble.swift` + `Components/SessionLogView.swift`. Mirror `tabs/MessagesTab.tsx`, `tabs/SessionLogTab.tsx`. Add `RestClient.postMessage`.

- [ ] **Step 1:** Add to `RestClient` (mirror `api.ts postMessage`):
```swift
static func postMessage(teamId: String, slug: String, text: String) async throws {
    var req = URLRequest(url: url(teamId, slug, "/messages"))
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue(try await authHeader(), forHTTPHeaderField: "Authorization")
    req.httpBody = try JSONSerialization.data(withJSONObject: ["text": text])
    let (data, resp) = try await URLSession.shared.data(for: req)
    try check(data, resp)
}
```
- [ ] **Step 2:** `MessagesTabStore` subscribes to `messages` + loop-scoped `sessionLog`. `MessagesTabView`: a segmented control (Messages | Session Log). Messages: thread of `MessageBubble` (author-styled, relative time, user delivery status), an agent-active hint (`store.agentActive` from ProjectDetailStore), and a compose box (TextField + Send) calling `postMessage`; send errors show inline `ErrorNote`; on success the thread updates via the live listener (no optimistic insert). Add a `relativeTime(Date?)` helper mirroring the web.
- [ ] **Step 3:** `SessionLogView` mirrors `SessionLogTab.tsx`: per-session blocks (start–end time), entries rendered by kind (you/claude/tool ✓✗), with a "show all" beyond 50 entries.
- [ ] **Step 4:** Build → SUCCEEDED; full suite green. Commit: `feat(ios): Messages tab (thread + compose + Session Log)`

---

## Task 14: Full verification + SP2 manual acceptance

**Files:** none.

- [ ] **Step 1:** Clean `cd ios && xcodegen generate && xcodebuild test ... -destination 'platform=iOS Simulator,name=iPhone 16e'` → all tests pass (SP1's 25 + SP2 additions). Quote the summary.
- [ ] **Step 2:** Manual acceptance (needs the real `GoogleService-Info.plist` + API URL from SP1's pending setup; reviewer/maintainer runs): open a project from the Dashboard; swipe through all six tabs and confirm tab-strip ↔ swipe stay in sync; switch loops and watch Dashboard + Loops update; confirm Vision documents render as Markdown; expand a Tests scenario and a Session Log session; send a message and watch it appear live. Use the [verify] skill if helpful.
- [ ] **Step 3:** Record pass/fail per item in the PR description; if anything fails use superpowers:systematic-debugging before claiming done (superpowers:verification-before-completion).

## Done criteria for SP2

- `xcodebuild test` green (SP1 25 + new model/rec/all-scope/tests-logic tests).
- All six tabs render live data, loop switching works, Markdown renders, a message can be sent.
- Clean `xcodegen generate` builds with only `Config/*` secrets supplied.
- No backend change; `firestore.rules` untouched; all-scope reads use the fan-out (no new indexes).
