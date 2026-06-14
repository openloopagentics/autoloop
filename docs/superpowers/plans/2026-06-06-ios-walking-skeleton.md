# iOS Walking Skeleton (SP1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable native iOS app that proves every architectural seam of the Autoloop mobile client end-to-end — Google sign-in + allowlist gate, live Firestore reads, one REST write, theming — with one real vertical slice (the Dashboard project list) and placeholders elsewhere.

**Architecture:** A thin SwiftUI client over the existing Autoloop backend. Reads use Firestore `addSnapshotListener` (gated by the shared `firestore.rules` + `users/{uid}.isAllowed`); writes go through the existing Cloud Functions REST API (`/v1/...`) with a Firebase ID token. Pure logic (`AccessGate`, `Status`, `LoopView`, `ScenarioState`) is ported 1:1 from the web app's tested TypeScript and unit-tested with the same cases. UI/Firebase/REST plumbing is verified by build + a scripted manual acceptance walkthrough.

**Tech Stack:** Swift 5.9+, SwiftUI, iOS 16 min target, `firebase-ios-sdk` (Auth + Firestore) and `GoogleSignIn-iOS` via Swift Package Manager, **XcodeGen** (`project.yml`) so the Xcode project is declarative and agent-editable. Tests via XCTest run with `xcodebuild test`.

**Spec:** `docs/superpowers/specs/2026-06-06-native-mobile-apps-design.md`

---

## Preconditions / environment

These are one-time host checks. If a tool is missing, stop and tell the human — do not silently skip.

- macOS with **Xcode** installed (`xcodebuild -version` works).
- **XcodeGen** installed (`xcodegen --version`). If missing: `brew install xcodegen`.
- An iOS Simulator available (`xcrun simctl list devices | grep -i iphone`).
- A real `GoogleService-Info.plist` for the Autoloop Firebase project, and the API base URL (`VITE_API_URL` value from `web/.env`). These hold secrets — they are gitignored; only `.example` files are committed. The human provides the real plist before the auth/Dashboard tasks (Task 9+) can be manually verified; pure-logic and build tasks do not need it.

Throughout, `SIM` means a booted simulator destination, e.g.:
`-destination 'platform=iOS Simulator,name=iPhone 15'`. Adjust the name to a device that exists on the host.

---

## File Structure

```
ios/
  project.yml                       # XcodeGen project definition (targets, SPM deps, config)
  .gitignore                        # ignores GoogleService-Info.plist, build/, *.xcodeproj
  Config/
    Autoloop.xcconfig               # API_BASE_URL (gitignored)
    Autoloop.xcconfig.example       # committed template
    GoogleService-Info.plist        # gitignored
    GoogleService-Info.plist.example# committed template
  Autoloop/
    App/
      AutoloopApp.swift             # @main; Firebase configure; injects AuthStore + Theme
      RootView.swift                # switches on AccessState (loading/signed-out/pending/allowed)
    Auth/
      AccessGate.swift              # pure deriveAccess(...) — port of gate.ts
      AuthStore.swift               # ObservableObject: Firebase auth + users/{uid} listener
    Data/
      AppConfig.swift               # reads API_BASE_URL from bundle/xcconfig
      Models.swift                  # Codable structs mirroring types.ts (SP1 subset)
      FirestoreDecode.swift         # timestamp + loose-field decoding helpers
      Listener.swift                # generic Firestore snapshot -> @Published Loadable<T>
      RestClient.swift              # Bearer-token write client (putProject in SP1)
    Domain/
      Status.swift                  # statusColor / isTerminalStatus — port of status.ts
      LoopView.swift                # buildLoopList/effectiveProjectStatus/... — port of loopView.ts
      ScenarioState.swift           # deriveScenarioState/summarize — port of scenarioState.ts
    UI/
      Theme.swift                   # 6-theme token palette + UserDefaults persistence
      AppShell.swift                # TabView + profile sheet
      Components/
        Spinner.swift
        StatusBadge.swift
        ErrorNote.swift
        EmptyState.swift
    Features/
      Auth/SignInView.swift         # "Sign in with Google"
      Auth/RequestAccessView.swift  # pending-access screen
      Dashboard/DashboardStore.swift# my teams + their projects (live)
      Dashboard/DashboardView.swift # the one real slice: list + one write
      Placeholders/TeamsView.swift  # placeholder
      Placeholders/KeysView.swift   # placeholder
      Placeholders/AdminView.swift  # placeholder
  AutoloopTests/
    AccessGateTests.swift
    StatusTests.swift
    LoopViewTests.swift
    ScenarioStateTests.swift
    ThemeTests.swift
    ModelsDecodeTests.swift
```

**Decomposition notes**
- Pure logic (`Auth/AccessGate`, `Domain/*`) has zero Firebase/UI dependency → fully unit-testable and ported first.
- `Data/Listener.swift` is protocol-light and thin so later SPs can inject fakes.
- Each `Features/*` view owns its store; stores depend on `Data/*`, not on each other.

---

## Task 1: Scaffold the Xcode project (XcodeGen) and verify it builds

**Files:**
- Create: `ios/project.yml`
- Create: `ios/.gitignore`
- Create: `ios/Config/Autoloop.xcconfig.example`, `ios/Config/Autoloop.xcconfig`
- Create: `ios/Config/GoogleService-Info.plist.example`
- Create: `ios/Autoloop/App/AutoloopApp.swift` (minimal placeholder)
- Create: `ios/Autoloop/UI/AppShell.swift` (temporary "Hello" body, replaced in Task 12)

- [ ] **Step 1: Write `ios/project.yml`**

```yaml
name: Autoloop
options:
  bundleIdPrefix: com.openloopagentics.autoloop
  deploymentTarget:
    iOS: "16.0"
configFiles:
  Debug: Config/Autoloop.xcconfig
  Release: Config/Autoloop.xcconfig
packages:
  Firebase:
    url: https://github.com/firebase/firebase-ios-sdk
    minVersion: 11.0.0
  GoogleSignIn:
    url: https://github.com/google/GoogleSignIn-iOS
    minVersion: 7.0.0
targets:
  Autoloop:
    type: application
    platform: iOS
    sources: [Autoloop]
    resources:
      - path: Config/GoogleService-Info.plist
        optional: true
    dependencies:
      - package: Firebase
        product: FirebaseAuth
      - package: Firebase
        product: FirebaseFirestore
      - package: GoogleSignIn
        product: GoogleSignIn
    settings:
      base:
        INFOPLIST_KEY_UILaunchScreen_Generation: true
        PRODUCT_BUNDLE_IDENTIFIER: com.openloopagentics.autoloop
  AutoloopTests:
    type: bundle.unit-test
    platform: iOS
    sources: [AutoloopTests]
    dependencies:
      - target: Autoloop
```

- [ ] **Step 2: Write `ios/.gitignore`**

```gitignore
build/
DerivedData/
*.xcodeproj
Config/Autoloop.xcconfig
Config/GoogleService-Info.plist
.DS_Store
```

(`*.xcodeproj` is ignored because it is generated by XcodeGen from `project.yml`.)

- [ ] **Step 3: Write config templates**

`ios/Config/Autoloop.xcconfig.example`:
```
// Copy to Autoloop.xcconfig and fill in. Mirrors web/.env VITE_API_URL.
API_BASE_URL = https:/$()/your-region-your-project.cloudfunctions.net
```
(The `/$()/` escape keeps xcconfig from treating `//` as a comment.)

`ios/Config/Autoloop.xcconfig` — same content with the real URL (gitignored).

`ios/Config/GoogleService-Info.plist.example` — a committed note file:
```xml
<!-- Placeholder. Download the real GoogleService-Info.plist from the Firebase
     console (iOS app, same project as web) and save as GoogleService-Info.plist
     in this folder. It is gitignored. -->
```

- [ ] **Step 4: Write minimal `AutoloopApp.swift`**

```swift
import SwiftUI

@main
struct AutoloopApp: App {
    var body: some Scene {
        WindowGroup { AppShell() }
    }
}
```

- [ ] **Step 5: Write temporary `AppShell.swift`**

```swift
import SwiftUI

struct AppShell: View {
    var body: some View { Text("Autoloop").padding() }
}
```

- [ ] **Step 6: Generate the project**

Run: `cd ios && xcodegen generate`
Expected: "Created project at .../Autoloop.xcodeproj". SPM resolves Firebase + GoogleSignIn (first run downloads packages; may take a few minutes).

- [ ] **Step 7: Build to verify the toolchain + dependencies resolve**

Run:
```bash
cd ios && xcodebuild build \
  -project Autoloop.xcodeproj -scheme Autoloop \
  -destination 'platform=iOS Simulator,name=iPhone 15'
```
Expected: `** BUILD SUCCEEDED **`. (If SPM resolution fails behind a proxy, surface to the human.)

- [ ] **Step 8: Commit**

```bash
git add ios/project.yml ios/.gitignore ios/Config/*.example ios/Autoloop/App/AutoloopApp.swift ios/Autoloop/UI/AppShell.swift
git commit -m "feat(ios): scaffold XcodeGen project with Firebase + GoogleSignIn"
```

---

## Task 2: AccessGate pure port (TDD)

Port of `web/src/auth/gate.ts` + `gate.test.ts`. No Firebase dependency.

**Files:**
- Create: `ios/Autoloop/Auth/AccessGate.swift`
- Test: `ios/AutoloopTests/AccessGateTests.swift`

- [ ] **Step 1: Write the failing test** (`AccessGateTests.swift`)

```swift
import XCTest
@testable import Autoloop

final class AccessGateTests: XCTestCase {
    private let u = AccessUser(uid: "u1", email: "u@x.com")

    func testLoadingUntilAuthResolves() {
        XCTAssertEqual(deriveAccess(.init(authResolved: false, user: nil, userDocResolved: false, isAllowed: false)), .loading)
    }
    func testSignedOutWhenResolvedAndNoUser() {
        XCTAssertEqual(deriveAccess(.init(authResolved: true, user: nil, userDocResolved: false, isAllowed: false)), .signedOut)
    }
    func testLoadingWhileUserDocUnresolved() {
        XCTAssertEqual(deriveAccess(.init(authResolved: true, user: u, userDocResolved: false, isAllowed: false)), .loading)
    }
    func testAllowedWhenDocResolvedAndAllowed() {
        XCTAssertEqual(deriveAccess(.init(authResolved: true, user: u, userDocResolved: true, isAllowed: true)), .allowed)
    }
    func testPendingWhenDocResolvedButNotAllowed() {
        XCTAssertEqual(deriveAccess(.init(authResolved: true, user: u, userDocResolved: true, isAllowed: false)), .pending)
    }
}
```

- [ ] **Step 2: Run the test, verify it fails to compile** (`deriveAccess` undefined)

Run: `cd ios && xcodebuild test -project Autoloop.xcodeproj -scheme Autoloop -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:AutoloopTests/AccessGateTests`
Expected: build/test FAILS (symbols not found).

- [ ] **Step 3: Implement `AccessGate.swift`**

```swift
import Foundation

enum AccessState { case loading, signedOut, pending, allowed }

struct AccessUser: Equatable { let uid: String; let email: String? }

struct AccessInputs {
    let authResolved: Bool
    let user: AccessUser?
    let userDocResolved: Bool
    let isAllowed: Bool
}

/// Direct port of web/src/auth/gate.ts deriveAccess.
func deriveAccess(_ i: AccessInputs) -> AccessState {
    if !i.authResolved { return .loading }
    guard i.user != nil else { return .signedOut }
    if !i.userDocResolved { return .loading } // flash-prevention
    return i.isAllowed ? .allowed : .pending
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: same `-only-testing:AutoloopTests/AccessGateTests` command.
Expected: `** TEST SUCCEEDED **`.

- [ ] **Step 5: Commit**

```bash
git add ios/Autoloop/Auth/AccessGate.swift ios/AutoloopTests/AccessGateTests.swift
git commit -m "feat(ios): port access gate state machine with tests"
```

---

## Task 3: Status domain port (TDD)

Port of `web/src/dashboard/status.ts` + `status.test.ts`.

**Files:**
- Create: `ios/Autoloop/Domain/Status.swift`
- Test: `ios/AutoloopTests/StatusTests.swift`

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import Autoloop

final class StatusTests: XCTestCase {
    func testMapsEachStatusToColor() {
        XCTAssertEqual(statusColor("queued"), .gray)
        XCTAssertEqual(statusColor("running"), .blue)
        XCTAssertEqual(statusColor("blocked"), .red)
        XCTAssertEqual(statusColor("paused"), .amber)
        XCTAssertEqual(statusColor("completed"), .green)
        XCTAssertEqual(statusColor("failed"), .red)
        XCTAssertEqual(statusColor("cancelled"), .gray)
    }
    func testDefaultsToGray() {
        XCTAssertEqual(statusColor("???"), .gray)
    }
    func testTerminalStatuses() {
        XCTAssertTrue(isTerminalStatus("completed"))
        XCTAssertTrue(isTerminalStatus("failed"))
        XCTAssertTrue(isTerminalStatus("cancelled"))
        XCTAssertFalse(isTerminalStatus("running"))
    }
}
```

- [ ] **Step 2: Run, verify it fails** (`-only-testing:AutoloopTests/StatusTests`). Expected: FAIL.

- [ ] **Step 3: Implement `Status.swift`**

```swift
import Foundation

/// Semantic status colors (mirrors the web's color classes; mapped to real colors in Theme).
enum StatusColor { case gray, blue, red, amber, green }

private let statusColors: [String: StatusColor] = [
    "queued": .gray, "running": .blue, "blocked": .red, "paused": .amber,
    "completed": .green, "failed": .red, "cancelled": .gray,
]

func statusColor(_ status: String) -> StatusColor { statusColors[status] ?? .gray }

private let terminalStatuses: Set<String> = ["completed", "failed", "cancelled"]
func isTerminalStatus(_ status: String) -> Bool { terminalStatuses.contains(status) }
```

- [ ] **Step 4: Run, verify it passes.** Expected: TEST SUCCEEDED.

- [ ] **Step 5: Commit**

```bash
git add ios/Autoloop/Domain/Status.swift ios/AutoloopTests/StatusTests.swift
git commit -m "feat(ios): port status color/terminal logic with tests"
```

---

## Task 4: LoopView domain port (TDD)

Port of `web/src/dashboard/loopView.ts`. Depends on `Status.isTerminalStatus`.

**Files:**
- Create: `ios/Autoloop/Domain/LoopView.swift`
- Test: `ios/AutoloopTests/LoopViewTests.swift`

- [ ] **Step 1: Write the failing test** (covers the non-trivial branches: sort order, main synthesis, default selection, effective status, phase progress)

```swift
import XCTest
@testable import Autoloop

final class LoopViewTests: XCTestCase {
    func testBasePath() {
        XCTAssertEqual(basePath(teamId: "t", slug: "s"), ["teams", "t", "projects", "s"])
        XCTAssertEqual(basePath(teamId: "t", slug: "s", loopId: "L1"),
                       ["teams", "t", "projects", "s", "loops", "L1"])
    }

    func testBuildLoopListSortsDescAndAppendsMain() {
        let loops = [LoopRec(id: "a", order: 1), LoopRec(id: "b", order: 2)]
        let proj = ProjectRec(slug: "s", status: "running")
        let list = buildLoopList(loops, project: proj, hasProjectDirectData: true)
        XCTAssertEqual(list.map(\.id), ["b", "a", "main"])     // desc by order, main last
        XCTAssertTrue(list.last!.isMain)
        XCTAssertEqual(list.last!.status, "running")           // main carries project status
    }

    func testDefaultSelectedLoopPrefersValidCurrent() {
        let list = buildLoopList([LoopRec(id: "a", order: 1)], project: nil, hasProjectDirectData: false)
        XCTAssertEqual(defaultSelectedLoop(list, currentLoopId: "a"), "a")
        XCTAssertEqual(defaultSelectedLoop(list, currentLoopId: "missing"), "a") // falls to latest explicit
        XCTAssertEqual(defaultSelectedLoop([], currentLoopId: "a"), "")
    }

    func testPhaseProgressCountsTerminal() {
        let phases = [PhaseRec(status: "completed"), PhaseRec(status: "running"), PhaseRec(status: "failed")]
        let p = phaseProgress(phases)
        XCTAssertEqual(p.done, 2); XCTAssertEqual(p.total, 3)
    }

    func testEffectiveProjectStatus() {
        XCTAssertEqual(effectiveProjectStatus([], projectStatus: "completed"), "completed")
        XCTAssertEqual(effectiveProjectStatus([("x", "queued", 1), ("y", "running", 0)].map(asLoop),
                                              projectStatus: "completed"), "running")
        XCTAssertEqual(effectiveProjectStatus([("x", "completed", 2), ("y", "failed", 1)].map(asLoop),
                                              projectStatus: nil), "completed") // latest by order
    }

    private func asLoop(_ t: (String, String, Int)) -> StatusLoop {
        StatusLoop(id: t.0, status: t.1, order: t.2)
    }
}
```

- [ ] **Step 2: Run, verify it fails.** (`-only-testing:AutoloopTests/LoopViewTests`)

- [ ] **Step 3: Implement `LoopView.swift`**

```swift
import Foundation

let MAIN_ID = "main"

// Minimal record types the pure functions operate on (the full Models come in Task 7;
// these protocols/structs keep the domain port dependency-free and testable).
struct LoopRec { var id: String; var goal: String? = nil; var name: String? = nil
    var status: String? = nil; var order: Int? = nil
    var currentPhaseId: String? = nil; var currentTaskId: String? = nil }
struct ProjectRec { var slug: String; var status: String? = nil
    var currentPhaseId: String? = nil; var currentTaskId: String? = nil }
struct PhaseRec { var status: String? = nil }
struct StatusLoop { var id: String; var status: String? = nil; var order: Int? = nil }

struct SelectableLoop: Equatable {
    var id: String; var isMain: Bool
    var goal: String? = nil; var name: String? = nil; var status: String? = nil; var order: Int? = nil
    var currentPhaseId: String? = nil; var currentTaskId: String? = nil
}

func basePath(teamId: String, slug: String, loopId: String? = nil) -> [String] {
    let base = ["teams", teamId, "projects", slug]
    return loopId.map { base + ["loops", $0] } ?? base
}

private func descByOrderThenId<T>(_ a: T, _ b: T, order: (T) -> Int?, id: (T) -> String) -> Bool {
    let oa = order(a) ?? 0, ob = order(b) ?? 0
    if oa != ob { return oa > ob }
    return id(a) > id(b) // b.localeCompare reversed => descending id
}

func buildLoopList(_ loops: [LoopRec], project: ProjectRec?, hasProjectDirectData: Bool) -> [SelectableLoop] {
    var list = loops
        .sorted { descByOrderThenId($0, $1, order: { $0.order }, id: { $0.id }) }
        .map { SelectableLoop(id: $0.id, isMain: false, goal: $0.goal, name: $0.name,
                              status: $0.status, order: $0.order,
                              currentPhaseId: $0.currentPhaseId, currentTaskId: $0.currentTaskId) }
    if hasProjectDirectData {
        list.append(SelectableLoop(id: MAIN_ID, isMain: true, name: "main", status: project?.status,
                                   currentPhaseId: project?.currentPhaseId, currentTaskId: project?.currentTaskId))
    }
    return list
}

func defaultSelectedLoop(_ list: [SelectableLoop], currentLoopId: String?) -> String {
    if list.isEmpty { return "" }
    if let c = currentLoopId, list.contains(where: { $0.id == c }) { return c }
    let explicit = list.filter { !$0.isMain }
    if let first = explicit.first { return first.id } // list is desc by order
    return list[list.count - 1].id // main
}

func phaseProgress(_ phases: [PhaseRec]) -> (done: Int, total: Int) {
    let done = phases.filter { ($0.status).map(isTerminalStatus) ?? false }.count
    return (done, phases.count)
}

func loopIsRunning(_ status: String?) -> Bool { status == "running" }

func effectiveProjectStatus(_ loops: [StatusLoop], projectStatus: String?) -> String? {
    if loops.isEmpty { return projectStatus }
    if loops.contains(where: { $0.status == "running" }) { return "running" }
    let latest = loops.sorted { descByOrderThenId($0, $1, order: { $0.order }, id: { $0.id }) }.first
    return latest?.status ?? projectStatus
}

func loopArgFor(_ loop: SelectableLoop?) -> String? {
    guard let loop, !loop.isMain else { return nil }
    return loop.id
}
```

- [ ] **Step 4: Run, verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add ios/Autoloop/Domain/LoopView.swift ios/AutoloopTests/LoopViewTests.swift
git commit -m "feat(ios): port loop-view selection/progress logic with tests"
```

---

## Task 5: ScenarioState domain port (TDD)

Port of `web/src/dashboard/scenarioState.ts`.

**Files:**
- Create: `ios/Autoloop/Domain/ScenarioState.swift`
- Test: `ios/AutoloopTests/ScenarioStateTests.swift`

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import Autoloop

final class ScenarioStateTests: XCTestCase {
    func testLatestById() {
        let r = latestById([IdItem(id: "01"), IdItem(id: "03"), IdItem(id: "02")])
        XCTAssertEqual(r?.id, "03")
        XCTAssertNil(latestById([IdItem]()))
    }

    func testMetRequiresThresholdAndZeroFailures() {
        let sc = ScenarioRec(id: "s1", threshold: 80)
        let scores = [ScoreRec(id: "01", scenarioId: "s1", composite: 85)]
        let runsPass = [TestRunRec(id: "01", scenarioId: "s1", failed: 0)]
        XCTAssertEqual(deriveScenarioState(sc, scores: scores, testRuns: runsPass).state, .met)

        let runsFail = [TestRunRec(id: "01", scenarioId: "s1", failed: 2)]
        XCTAssertEqual(deriveScenarioState(sc, scores: scores, testRuns: runsFail).state, .unmet)

        let low = [ScoreRec(id: "01", scenarioId: "s1", composite: 50)]
        XCTAssertEqual(deriveScenarioState(sc, scores: low, testRuns: runsPass).state, .unmet)
    }

    func testDefaultThresholdEighty() {
        let sc = ScenarioRec(id: "s1", threshold: nil)
        let scores = [ScoreRec(id: "01", scenarioId: "s1", composite: 80)]
        let runs = [TestRunRec(id: "01", scenarioId: "s1", failed: 0)]
        XCTAssertEqual(deriveScenarioState(sc, scores: scores, testRuns: runs).state, .met)
    }

    func testSummarizeCountsMet() {
        let scs = [ScenarioRec(id: "a", threshold: 80), ScenarioRec(id: "b", threshold: 80)]
        let scores = [ScoreRec(id: "01", scenarioId: "a", composite: 90)]
        let runs = [TestRunRec(id: "01", scenarioId: "a", failed: 0)]
        let s = summarize(scs, scores: scores, testRuns: runs)
        XCTAssertEqual(s.met, 1); XCTAssertEqual(s.total, 2)
    }
}
```

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement `ScenarioState.swift`**

```swift
import Foundation

let DEFAULT_THRESHOLD = 80

protocol Identified { var id: String { get } }
struct IdItem: Identified { var id: String }

struct ScenarioRec: Identified { var id: String; var threshold: Int? = nil }
struct ScoreRec: Identified { var id: String; var scenarioId: String?; var composite: Double? = nil }
struct TestRunRec: Identified { var id: String; var scenarioId: String?; var failed: Int? = nil }

/// Lexically greatest id (ULID-keyed => id order == time order).
func latestById<T: Identified>(_ items: [T]) -> T? {
    items.reduce(into: T?.none) { best, it in
        if best == nil || it.id > best!.id { best = it }
    }
}

enum ScenarioMet { case met, unmet }
struct ScenarioState { let state: ScenarioMet; let latestComposite: Double?; let latestTest: TestRunRec? }

func deriveScenarioState(_ scenario: ScenarioRec, scores: [ScoreRec], testRuns: [TestRunRec]) -> ScenarioState {
    let myScores = scores.filter { $0.scenarioId == scenario.id }
    let myRuns = testRuns.filter { $0.scenarioId == scenario.id }
    let latestScore = latestById(myScores)
    let latestTest = latestById(myRuns)
    let threshold = Double(scenario.threshold ?? DEFAULT_THRESHOLD)
    let composite = latestScore?.composite
    let met = composite != nil && composite! >= threshold
        && latestTest != nil && (latestTest!.failed ?? 0) == 0
    return ScenarioState(state: met ? .met : .unmet, latestComposite: composite, latestTest: latestTest)
}

func summarize(_ scenarios: [ScenarioRec], scores: [ScoreRec], testRuns: [TestRunRec]) -> (met: Int, total: Int) {
    let met = scenarios.filter { deriveScenarioState($0, scores: scores, testRuns: testRuns).state == .met }.count
    return (met, scenarios.count)
}
```

- [ ] **Step 4: Run, verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add ios/Autoloop/Domain/ScenarioState.swift ios/AutoloopTests/ScenarioStateTests.swift
git commit -m "feat(ios): port scenario met/unmet derivation with tests"
```

---

## Task 6: Theme tokens + persistence (TDD for persistence)

Port of `web/src/ui/theme.ts` (6 themes, default `dark`, persisted). The web key is `autoloop-theme`.

**Files:**
- Create: `ios/Autoloop/UI/Theme.swift`
- Test: `ios/AutoloopTests/ThemeTests.swift`

- [ ] **Step 1: Write the failing test** (persistence/default logic only — colors are visual)

```swift
import XCTest
@testable import Autoloop

final class ThemeTests: XCTestCase {
    private func freshDefaults() -> UserDefaults {
        let d = UserDefaults(suiteName: "theme-test")!
        d.removePersistentDomain(forName: "theme-test")
        return d
    }

    func testDefaultsToDarkWhenUnset() {
        XCTAssertEqual(ThemeStore(defaults: freshDefaults()).current.id, "dark")
    }
    func testPersistsValidSelection() {
        let d = freshDefaults()
        let s = ThemeStore(defaults: d); s.select("forest")
        XCTAssertEqual(ThemeStore(defaults: d).current.id, "forest")
    }
    func testIgnoresUnknownThemeId() {
        let d = freshDefaults(); d.set("not-a-theme", forKey: "autoloop-theme")
        XCTAssertEqual(ThemeStore(defaults: d).current.id, "dark")
    }
    func testSixThemesPresentInOrder() {
        XCTAssertEqual(THEMES.map(\.id), ["dark", "light", "midnight", "forest", "nord", "rose"])
    }
}
```

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement `Theme.swift`** (token palette + `ThemeStore`)

```swift
import SwiftUI

struct ThemeOption: Identifiable, Equatable {
    let id: String; let label: String; let swatch: Color
    // SP1: swatch only (used for the picker dots). Full surface palettes land in SP2.
}

let THEMES: [ThemeOption] = [
    .init(id: "dark",     label: "Espresso", swatch: Color(hex: 0xb89058)),
    .init(id: "light",    label: "Daylight", swatch: Color(hex: 0x2563eb)),
    .init(id: "midnight", label: "Midnight", swatch: Color(hex: 0x4db5e8)),
    .init(id: "forest",   label: "Forest",   swatch: Color(hex: 0x5fb87a)),
    .init(id: "nord",     label: "Nord",     swatch: Color(hex: 0x88c0d0)),
    .init(id: "rose",     label: "Rosé",     swatch: Color(hex: 0xd98bb0)),
]

private let THEME_KEY = "autoloop-theme"
private let DEFAULT_THEME = "dark"

final class ThemeStore: ObservableObject {
    private let defaults: UserDefaults
    @Published private(set) var current: ThemeOption

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let saved = defaults.string(forKey: THEME_KEY)
        self.current = THEMES.first { $0.id == saved } ?? THEMES.first { $0.id == DEFAULT_THEME }!
    }

    func select(_ id: String) {
        guard let t = THEMES.first(where: { $0.id == id }) else { return }
        current = t
        defaults.set(id, forKey: THEME_KEY)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xff) / 255,
                  green: Double((hex >> 8) & 0xff) / 255,
                  blue: Double(hex & 0xff) / 255)
    }
}
```

- [ ] **Step 4: Run, verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add ios/Autoloop/UI/Theme.swift ios/AutoloopTests/ThemeTests.swift
git commit -m "feat(ios): theme tokens + persisted ThemeStore with tests"
```

---

## Task 7: Models + Firestore decoding (TDD for decoding)

Codable structs for the SP1 read slice (`Team`, `TeamRef`, `Project`) plus a decoding helper for Firestore `Timestamp` and loose fields. This is the spec's flagged risk area — pin it down here.

**Files:**
- Create: `ios/Autoloop/Data/Models.swift`
- Create: `ios/Autoloop/Data/FirestoreDecode.swift`
- Test: `ios/AutoloopTests/ModelsDecodeTests.swift`

- [ ] **Step 1: Write the failing test** — decode a `[String: Any]` Firestore-shaped dict into `Project`, tolerating missing/extra fields.

```swift
import XCTest
@testable import Autoloop

final class ModelsDecodeTests: XCTestCase {
    func testProjectFromFirestoreDict() {
        let doc: [String: Any] = ["title": "Demo", "status": "running", "extra": 42]
        let p = Project(slug: "demo", data: doc)
        XCTAssertEqual(p.slug, "demo")
        XCTAssertEqual(p.title, "Demo")
        XCTAssertEqual(p.status, "running")
    }
    func testProjectToleratesMissingFields() {
        let p = Project(slug: "x", data: [:])
        XCTAssertEqual(p.slug, "x")
        XCTAssertNil(p.title)
        XCTAssertNil(p.status)
    }
    func testTeamRefFromMemberDoc() {
        let t = TeamRef(teamId: "t1", data: ["role": "owner"])
        XCTAssertEqual(t.teamId, "t1"); XCTAssertEqual(t.role, "owner")
    }
}
```

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement `FirestoreDecode.swift` + `Models.swift`**

`FirestoreDecode.swift` — small typed accessors over `[String: Any]` (avoids fighting `Codable` against Firestore's dynamic dicts; this is the deliberate strategy from the spec):
```swift
import Foundation
import FirebaseFirestore

extension Dictionary where Key == String, Value == Any {
    func str(_ k: String) -> String? { self[k] as? String }
    func bool(_ k: String) -> Bool? { self[k] as? Bool }
    func int(_ k: String) -> Int? {
        if let i = self[k] as? Int { return i }
        if let n = self[k] as? NSNumber { return n.intValue }
        return nil
    }
    func double(_ k: String) -> Double? {
        if let d = self[k] as? Double { return d }
        if let n = self[k] as? NSNumber { return n.doubleValue }
        return nil
    }
    /// Firestore Timestamp -> Date (the loose `unknown` time fields in types.ts).
    func date(_ k: String) -> Date? { (self[k] as? Timestamp)?.dateValue() }
}
```

`Models.swift` (SP1 subset; grows in SP2):
```swift
import Foundation

struct TeamRef: Identifiable, Equatable {
    let teamId: String; let role: String
    var id: String { teamId }
    init(teamId: String, role: String) { self.teamId = teamId; self.role = role }
    init(teamId: String, data: [String: Any]) {
        self.init(teamId: teamId, role: data.str("role") ?? "")
    }
}

struct Team: Equatable { let name: String?
    init(name: String?) { self.name = name }
    init(data: [String: Any]) { self.init(name: data.str("name")) }
}

struct Project: Identifiable, Equatable {
    let slug: String
    let title: String?
    let status: String?
    let currentLoopId: String?
    var id: String { slug }
    init(slug: String, title: String? = nil, status: String? = nil, currentLoopId: String? = nil) {
        self.slug = slug; self.title = title; self.status = status; self.currentLoopId = currentLoopId
    }
    init(slug: String, data: [String: Any]) {
        self.init(slug: slug, title: data.str("title"), status: data.str("status"),
                  currentLoopId: data.str("currentLoopId"))
    }
}
```

- [ ] **Step 4: Run, verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add ios/Autoloop/Data/Models.swift ios/Autoloop/Data/FirestoreDecode.swift ios/AutoloopTests/ModelsDecodeTests.swift
git commit -m "feat(ios): models + Firestore dict decoding with tests"
```

---

## Task 8: AppConfig + Firebase configure

Wire Firebase initialization and read the API base URL from the xcconfig (surfaced through Info.plist).

**Files:**
- Create: `ios/Autoloop/Data/AppConfig.swift`
- Modify: `ios/project.yml` (add `API_BASE_URL` to the target's Info.plist generation)
- Modify: `ios/Autoloop/App/AutoloopApp.swift`

- [ ] **Step 1: Expose `API_BASE_URL` via Info.plist** — in `project.yml`, under `targets.Autoloop.settings.base`, add an Info.plist key sourced from the build setting. Add to the target:
```yaml
    info:
      path: Autoloop/Info.plist
      properties:
        API_BASE_URL: $(API_BASE_URL)
        CFBundleURLTypes:                 # GoogleSignIn reversed-client-id callback (filled in Task 9)
          - CFBundleURLSchemes: [REVERSED_CLIENT_ID_PLACEHOLDER]
```
Re-run `cd ios && xcodegen generate`.

- [ ] **Step 2: Implement `AppConfig.swift`**

```swift
import Foundation

enum AppConfig {
    static var apiBaseURL: String {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String) ?? ""
        return raw.hasSuffix("/") ? String(raw.dropLast()) : raw   // mirror api.ts replace(/\/$/, "")
    }
}
```

- [ ] **Step 3: Configure Firebase in `AutoloopApp.swift`**

```swift
import SwiftUI
import FirebaseCore

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ app: UIApplication,
                     didFinishLaunchingWithOptions opts: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        FirebaseApp.configure()
        return true
    }
}

@main
struct AutoloopApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var auth = AuthStore()
    @StateObject private var theme = ThemeStore()
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(auth).environmentObject(theme)
        }
    }
}
```

(`AuthStore`/`RootView` arrive in Task 9; this will not compile until then — that is fine, they are committed together in Task 9. To keep Task 8 independently green, temporarily inject only `theme` and keep `AppShell()` as the body; swap to `RootView` in Task 9.)

- [ ] **Step 4: Build** (with `theme` only) to verify Firebase links and `FirebaseApp.configure()` runs.

Run: `cd ios && xcodebuild build -project Autoloop.xcodeproj -scheme Autoloop -destination 'platform=iOS Simulator,name=iPhone 15'`
Expected: BUILD SUCCEEDED. (Requires the real `GoogleService-Info.plist`; if absent, the build still succeeds but the app will assert at launch — note for the human.)

- [ ] **Step 5: Commit**

```bash
git add ios/project.yml ios/Autoloop/Data/AppConfig.swift ios/Autoloop/App/AutoloopApp.swift
git commit -m "feat(ios): Firebase configure + API base URL from xcconfig"
```

---

## Task 9: AuthStore + RootView + auth screens (Google sign-in + gate)

The live auth seam. Verified by build + manual sign-in (needs the real plist).

**Files:**
- Create: `ios/Autoloop/Auth/AuthStore.swift`
- Create: `ios/Autoloop/App/RootView.swift`
- Create: `ios/Autoloop/Features/Auth/SignInView.swift`
- Create: `ios/Autoloop/Features/Auth/RequestAccessView.swift`
- Create: `ios/Autoloop/UI/Components/Spinner.swift`
- Modify: `ios/Autoloop/App/AutoloopApp.swift` (inject `auth`, use `RootView`)
- Modify: `ios/project.yml` (set the real `REVERSED_CLIENT_ID` URL scheme from GoogleService-Info)

- [ ] **Step 1: Implement `AuthStore.swift`** — ports `AuthProvider.tsx`.

```swift
import Foundation
import FirebaseAuth
import FirebaseCore
import FirebaseFirestore
import GoogleSignIn

@MainActor
final class AuthStore: ObservableObject {
    @Published private(set) var state: AccessState = .loading
    @Published private(set) var user: AccessUser?
    @Published private(set) var isAdmin = false
    @Published var signInError: String?

    private var authResolved = false
    private var userDocResolved = false
    private var isAllowed = false
    private var authHandle: AuthStateDidChangeListenerHandle?
    private var docListener: ListenerRegistration?

    init() { listen() }

    private func recompute() {
        state = deriveAccess(.init(authResolved: authResolved, user: user,
                                   userDocResolved: userDocResolved, isAllowed: isAllowed))
    }

    private func listen() {
        authHandle = Auth.auth().addStateDidChangeListener { [weak self] _, u in
            guard let self else { return }
            self.docListener?.remove(); self.docListener = nil
            self.userDocResolved = false; self.isAllowed = false; self.isAdmin = false
            self.authResolved = true
            guard let u else { self.user = nil; self.recompute(); return }
            self.user = AccessUser(uid: u.uid, email: u.email)
            self.recompute()
            self.docListener = Firestore.firestore().collection("users").document(u.uid)
                .addSnapshotListener { [weak self] snap, _ in
                    guard let self else { return }
                    let data = snap?.data() ?? [:]
                    self.isAllowed = (data["isAllowed"] as? Bool) == true
                    self.isAdmin = (data["isAdmin"] as? Bool) == true
                    self.userDocResolved = true
                    self.recompute()
                }
        }
    }

    func signIn() async {
        signInError = nil
        guard let clientID = FirebaseApp.app()?.options.clientID,
              let root = UIApplication.shared.topViewController() else { return }
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
        do {
            let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: root)
            guard let idToken = result.user.idToken?.tokenString else { return }
            let cred = GoogleAuthProvider.credential(withIDToken: idToken,
                                                     accessToken: result.user.accessToken.tokenString)
            try await Auth.auth().signIn(with: cred)
        } catch let e as NSError {
            if e.code == GIDSignInError.canceled.rawValue { return } // swallow cancel, like the web
            signInError = e.localizedDescription
        }
    }

    func signOut() {
        try? Auth.auth().signOut()
        GIDSignIn.sharedInstance.signOut()
    }
}
```
Add a small `UIApplication.topViewController()` helper in the same file (standard window-scene traversal).

- [ ] **Step 2: Implement `Spinner.swift`, `SignInView.swift`, `RequestAccessView.swift`, `RootView.swift`**

```swift
// Spinner.swift
import SwiftUI
struct Spinner: View {
    var label: String = "Connecting to the live board…"
    var body: some View {
        VStack(spacing: 12) { ProgressView(); Text(label).foregroundStyle(.secondary) }
    }
}
```
```swift
// RootView.swift
import SwiftUI
struct RootView: View {
    @EnvironmentObject var auth: AuthStore
    var body: some View {
        switch auth.state {
        case .loading:   Spinner()
        case .signedOut: SignInView()
        case .pending:   RequestAccessView()
        case .allowed:   AppShell()
        }
    }
}
```
```swift
// SignInView.swift
import SwiftUI
struct SignInView: View {
    @EnvironmentObject var auth: AuthStore
    var body: some View {
        VStack(spacing: 16) {
            Text("autoloop").font(.largeTitle.bold())
            Button("Sign in with Google") { Task { await auth.signIn() } }
                .buttonStyle(.borderedProminent)
            if let err = auth.signInError { Text(err).foregroundStyle(.red).font(.footnote) }
        }.padding()
    }
}
```
```swift
// RequestAccessView.swift
import SwiftUI
struct RequestAccessView: View {
    @EnvironmentObject var auth: AuthStore
    var body: some View {
        VStack(spacing: 16) {
            Text("Access pending").font(.title2.bold())
            Text("Your account (\(auth.user?.email ?? "")) isn’t on the allowlist yet.")
                .multilineTextAlignment(.center).foregroundStyle(.secondary)
            Button("Sign out") { auth.signOut() }
        }.padding()
    }
}
```

- [ ] **Step 3: Wire `RootView` + `auth` into `AutoloopApp.swift`** (replace the temporary `AppShell()` body and inject `auth`).

- [ ] **Step 4: Set the GoogleSignIn URL scheme** — read `REVERSED_CLIENT_ID` from `GoogleService-Info.plist` and put it in `project.yml`'s `CFBundleURLSchemes` (replacing the placeholder), then `xcodegen generate`.

- [ ] **Step 5: Build, then manual-verify on the simulator** (requires real plist + an allowlisted and a non-allowlisted Google account):

Run: `cd ios && xcodebuild build -project Autoloop.xcodeproj -scheme Autoloop -destination 'platform=iOS Simulator,name=iPhone 15'` → BUILD SUCCEEDED.
Then run the app in the simulator (Xcode ▶ or `xcrun simctl`) and confirm:
  - Cold launch shows the spinner, then the Sign-in screen.
  - Signing in with a **non-allowlisted** account → "Access pending".
  - Signing in with an **allowlisted** account → lands on `AppShell` (currently the Task 5/temporary shell; full shell in Task 12).
  - No "pending" flash before the user doc resolves.

- [ ] **Step 6: Commit**

```bash
git add ios/Autoloop/Auth/AuthStore.swift ios/Autoloop/App/RootView.swift ios/Autoloop/Features/Auth/ ios/Autoloop/UI/Components/Spinner.swift ios/Autoloop/App/AutoloopApp.swift ios/project.yml
git commit -m "feat(ios): Google sign-in + allowlist gate (AuthStore, RootView, auth screens)"
```

---

## Task 10: Generic Firestore listener + DashboardStore (live reads)

**Files:**
- Create: `ios/Autoloop/Data/Listener.swift`
- Create: `ios/Autoloop/Features/Dashboard/DashboardStore.swift`

> **Index note (from spec review):** `useMyTeams` is a `collectionGroup("members").where("uid", ==)` query. Firestore requires a collection-group index for this; the web app already relies on it, so it should exist. If the listener errors with a `FAILED_PRECONDITION` / "requires an index" message, follow the console link or add it to `firestore.indexes.json` and deploy — but do not assume it is missing without seeing that error.

- [ ] **Step 1: Implement `Listener.swift`** — generic snapshot → `@Published` loadable.

```swift
import Foundation
import FirebaseFirestore

struct Loadable<T> {
    var data: T
    var loading: Bool = true
    var error: String? = nil
}

/// Thin wrapper so feature stores stay testable; mirrors hooks.ts Result<T>.
final class QueryListener<T> {
    private var reg: ListenerRegistration?
    func start(_ query: Query, map: @escaping ([QueryDocumentSnapshot]) -> T,
               onChange: @escaping (Result<T, Error>) -> Void) {
        reg?.remove()
        reg = query.addSnapshotListener { snap, err in
            if let err { onChange(.failure(err)); return }
            onChange(.success(map(snap?.documents ?? [])))
        }
    }
    func stop() { reg?.remove(); reg = nil }
    deinit { stop() }
}
```

- [ ] **Step 2: Implement `DashboardStore.swift`** — `useMyTeams` + `useTeamProjects` per team, merged into a flat project list with their `teamId`.

```swift
import Foundation
import FirebaseAuth
import FirebaseFirestore

struct ProjectRow: Identifiable, Equatable {
    let teamId: String
    let project: Project
    var id: String { "\(teamId)/\(project.slug)" }
}

@MainActor
final class DashboardStore: ObservableObject {
    @Published var rows: [ProjectRow] = []
    @Published var loading = true
    @Published var error: String?

    private let db = Firestore.firestore()
    private let teamsListener = QueryListener<[TeamRef]>()
    private var projectListeners: [String: ListenerRegistration] = [:]
    private var byTeam: [String: [ProjectRow]] = [:]

    func start() {
        guard let uid = Auth.auth().currentUser?.uid else { loading = false; return }
        let q = db.collectionGroup("members").whereField("uid", isEqualTo: uid)
        teamsListener.start(q, map: { docs in
            docs.compactMap { d -> TeamRef? in
                guard let teamId = d.reference.parent.parent?.documentID else { return nil }
                return TeamRef(teamId: teamId, data: d.data())
            }
        }, onChange: { [weak self] result in
            Task { @MainActor in self?.handleTeams(result) }
        })
    }

    private func handleTeams(_ result: Result<[TeamRef], Error>) {
        switch result {
        case .failure(let e): error = e.localizedDescription; loading = false
        case .success(let teams):
            let ids = Set(teams.map(\.teamId))
            // tear down listeners for teams we left
            for (id, reg) in projectListeners where !ids.contains(id) {
                reg.remove(); projectListeners[id] = nil; byTeam[id] = nil
            }
            for t in teams where projectListeners[t.teamId] == nil {
                listenProjects(teamId: t.teamId)
            }
            rebuild(); loading = false
        }
    }

    private func listenProjects(teamId: String) {
        projectListeners[teamId] = db.collection("teams").document(teamId).collection("projects")
            .addSnapshotListener { [weak self] snap, err in
                Task { @MainActor in
                    guard let self else { return }
                    if let err { self.error = err.localizedDescription; return }
                    self.byTeam[teamId] = (snap?.documents ?? []).map {
                        ProjectRow(teamId: teamId, project: Project(slug: $0.documentID, data: $0.data()))
                    }
                    self.rebuild()
                }
            }
    }

    private func rebuild() {
        rows = byTeam.values.flatMap { $0 }.sorted { $0.id < $1.id }
    }

    func stop() {
        teamsListener.stop()
        projectListeners.values.forEach { $0.remove() }
        projectListeners.removeAll(); byTeam.removeAll()
    }
}
```

- [ ] **Step 3: Build to verify it compiles.**

Run: `cd ios && xcodebuild build -project Autoloop.xcodeproj -scheme Autoloop -destination 'platform=iOS Simulator,name=iPhone 15'` → BUILD SUCCEEDED.

- [ ] **Step 4: Commit**

```bash
git add ios/Autoloop/Data/Listener.swift ios/Autoloop/Features/Dashboard/DashboardStore.swift
git commit -m "feat(ios): live dashboard reads (teams collectionGroup + projects)"
```

---

## Task 11: RestClient (Bearer-token writes)

Port of `web/src/dashboard/api.ts` (SP1 wires only `putProject`).

**Files:**
- Create: `ios/Autoloop/Data/RestClient.swift`

- [ ] **Step 1: Implement `RestClient.swift`**

```swift
import Foundation
import FirebaseAuth

struct ApiError: LocalizedError { let message: String; var errorDescription: String? { message } }

enum RestClient {
    private static func authHeader() async throws -> String {
        guard let user = Auth.auth().currentUser else { throw ApiError(message: "Not signed in") }
        let token = try await user.getIDToken()
        return "Bearer \(token)"
    }

    private static func check(_ data: Data, _ resp: URLResponse) throws {
        guard let http = resp as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            // decode { error: { message } } like api.ts
            let msg = (try? JSONSerialization.jsonObject(with: data))
                .flatMap { ($0 as? [String: Any])?["error"] as? [String: Any] }?["message"] as? String
            throw ApiError(message: msg ?? "HTTP \(http.statusCode)")
        }
    }

    private static func url(_ teamId: String, _ slug: String, _ rest: String = "") -> URL {
        URL(string: "\(AppConfig.apiBaseURL)/v1/u/teams/\(teamId)/projects/\(slug)\(rest)")!
    }

    /// Mirrors api.ts putProject: defaults status to "running".
    static func putProject(teamId: String, slug: String, title: String, status: String = "running") async throws {
        var req = URLRequest(url: url(teamId, slug))
        req.httpMethod = "PUT"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(try await authHeader(), forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["title": title, "status": status])
        let (data, resp) = try await URLSession.shared.data(for: req)
        try check(data, resp)
    }
}
```

- [ ] **Step 2: Build to verify it compiles.** Expected: BUILD SUCCEEDED.

- [ ] **Step 3: Commit**

```bash
git add ios/Autoloop/Data/RestClient.swift
git commit -m "feat(ios): REST write client with Bearer token + error decoding"
```

---

## Task 12: AppShell (TabView + profile sheet + placeholders)

**Files:**
- Modify: `ios/Autoloop/UI/AppShell.swift` (replace the temporary body)
- Create: `ios/Autoloop/Features/Placeholders/TeamsView.swift`, `KeysView.swift`, `AdminView.swift`
- Create: `ios/Autoloop/UI/Components/EmptyState.swift`

- [ ] **Step 1: Implement placeholder views** — each a simple `EmptyState` ("Teams — coming in SP3", etc.).

- [ ] **Step 2: Implement `AppShell.swift`**

```swift
import SwiftUI

struct AppShell: View {
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject var theme: ThemeStore
    @State private var showProfile = false

    var body: some View {
        TabView {
            NavigationStack { DashboardView() }
                .tabItem { Label("Dashboard", systemImage: "square.grid.2x2") }
            NavigationStack { TeamsView() }
                .tabItem { Label("Teams", systemImage: "person.2") }
            NavigationStack { KeysView() }
                .tabItem { Label("Keys", systemImage: "key") }
            if auth.isAdmin {
                NavigationStack { AdminView() }
                    .tabItem { Label("Admin", systemImage: "shield") }
            }
        }
        .toolbar { ToolbarItem(placement: .topBarTrailing) {
            Button { showProfile = true } label: { Image(systemName: "person.crop.circle") }
        } }
        .sheet(isPresented: $showProfile) { profileSheet }
    }

    private var profileSheet: some View {
        NavigationStack {
            List {
                Section("Signed in as") { Text(auth.user?.email ?? "—") }
                Section("Theme") {
                    ForEach(THEMES) { t in
                        Button { theme.select(t.id) } label: {
                            HStack {
                                Circle().fill(t.swatch).frame(width: 14, height: 14)
                                Text(t.label)
                                Spacer()
                                if theme.current.id == t.id { Image(systemName: "checkmark") }
                            }
                        }.foregroundStyle(.primary)
                    }
                }
                Section {
                    // Getting Started is a placeholder row in SP1 (full screen in a later SP) —
                    // kept here to preserve parity with the web profile menu.
                    Label("Getting started", systemImage: "questionmark.circle")
                    Button("Sign out", role: .destructive) { auth.signOut() }
                }
            }.navigationTitle("Account")
        }
    }
}
```
(The `.toolbar` lives inside each tab's `NavigationStack`; if the trailing button does not show under `TabView`, move the toolbar/profile button into `DashboardView`'s `NavigationStack` — acceptable for SP1.)

- [ ] **Step 3: Build.** Expected: BUILD SUCCEEDED.

- [ ] **Step 4: Commit**

```bash
git add ios/Autoloop/UI/AppShell.swift ios/Autoloop/Features/Placeholders/ ios/Autoloop/UI/Components/EmptyState.swift
git commit -m "feat(ios): app shell tab nav + profile sheet (theme picker, sign out)"
```

---

## Task 13: DashboardView — the real slice (live list + one write)

**Files:**
- Create: `ios/Autoloop/Features/Dashboard/DashboardView.swift`
- Create: `ios/Autoloop/UI/Components/StatusBadge.swift`, `ios/Autoloop/UI/Components/ErrorNote.swift`

- [ ] **Step 1: Implement `StatusBadge.swift` + `ErrorNote.swift`** — `StatusBadge` maps `statusColor(_:)` to a SwiftUI `Color`; `ErrorNote` shows an inline red message.

```swift
// StatusBadge.swift
import SwiftUI
struct StatusBadge: View {
    let status: String
    private var color: Color {
        switch statusColor(status) {
        case .gray: return .gray; case .blue: return .blue; case .red: return .red
        case .amber: return .orange; case .green: return .green
        }
    }
    var body: some View {
        Text(status).font(.caption).padding(.horizontal, 8).padding(.vertical, 2)
            .background(color.opacity(0.18)).foregroundStyle(color).clipShape(Capsule())
    }
}
```

- [ ] **Step 2: Implement `DashboardView.swift`** — live list + a rename action that calls `RestClient.putProject` (the one write).

```swift
import SwiftUI

struct DashboardView: View {
    @StateObject private var store = DashboardStore()
    @State private var renaming: ProjectRow?
    @State private var newTitle = ""
    @State private var writeError: String?

    var body: some View {
        Group {
            if store.loading { Spinner(label: "Loading projects…") }
            else if let e = store.error { ErrorNote(message: e) }
            else if store.rows.isEmpty { EmptyState(text: "No projects yet.") }
            else {
                List(store.rows) { row in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(row.project.title ?? row.project.slug).font(.headline)
                            Text(row.teamId).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if let s = row.project.status { StatusBadge(status: s) }
                    }
                    .swipeActions {
                        Button("Rename") { renaming = row; newTitle = row.project.title ?? "" }
                    }
                }
            }
        }
        .navigationTitle("Dashboard")
        .onAppear { store.start() }
        .onDisappear { store.stop() }
        .alert("Rename project", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Title", text: $newTitle)
            Button("Save") { Task { await save() } }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
        .alert("Write failed", isPresented: Binding(get: { writeError != nil }, set: { if !$0 { writeError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(writeError ?? "") }
    }

    private func save() async {
        guard let row = renaming else { return }
        do {
            try await RestClient.putProject(teamId: row.teamId, slug: row.project.slug,
                                            title: newTitle, status: row.project.status ?? "running")
            renaming = nil  // the Firestore listener will reflect the new title live
        } catch { writeError = error.localizedDescription }
    }
}
```

- [ ] **Step 3: Build.** Expected: BUILD SUCCEEDED.

- [ ] **Step 4: Commit**

```bash
git add ios/Autoloop/Features/Dashboard/DashboardView.swift ios/Autoloop/UI/Components/StatusBadge.swift ios/Autoloop/UI/Components/ErrorNote.swift
git commit -m "feat(ios): dashboard live project list + rename write (vertical slice)"
```

---

## Task 14: Full test run + SP1 manual acceptance

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit test suite**

Run: `cd ios && xcodebuild test -project Autoloop.xcodeproj -scheme Autoloop -destination 'platform=iOS Simulator,name=iPhone 15'`
Expected: all `AutoloopTests` pass (AccessGate, Status, LoopView, ScenarioState, Theme, ModelsDecode). Capture the summary line in the commit/PR.

- [ ] **Step 2: Manual acceptance walkthrough** (real plist + allowlisted/non-allowlisted Google accounts). Use the [verify] skill if helpful. Confirm:
  1. Launch → spinner → Sign-in screen.
  2. Non-allowlisted account → "Access pending"; no pending-flash before the doc resolves.
  3. Allowlisted account → tab shell (Dashboard/Teams/Keys, + Admin only if the account is admin).
  4. Dashboard shows real projects; editing a project elsewhere (web/CLI) updates the list **live**.
  5. Swipe → Rename → Save → the title updates live (write path proven); a forced failure (e.g. wrong API URL) shows the inline error.
  6. Profile sheet: theme selection persists across an app relaunch; Sign out returns to the Sign-in screen.

- [ ] **Step 3: Record results** — note pass/fail for each acceptance item in the PR description. If any fail, use superpowers:systematic-debugging before claiming completion (see superpowers:verification-before-completion).

---

## Done criteria for SP1

- `xcodebuild test` is green (6 test files).
- The manual acceptance walkthrough passes all 6 items.
- The app builds from a clean `xcodegen generate` with only `Config/*` secrets supplied by the human.
- Auth gate, live Firestore reads, one REST write, and theming are all proven end-to-end — the seams SP2–SP4 build on.
