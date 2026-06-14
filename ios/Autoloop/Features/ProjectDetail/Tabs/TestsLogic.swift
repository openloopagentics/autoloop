import Foundation

/// Pure grouping logic for the Tests tab, extracted from TestsTab.tsx so it's
/// testable without Firebase.

enum TestGroupState { case pass, fail, none }

struct TestGroup {
    let scenarioId: String
    let title: String
    let runs: [TestRun]
    let latest: TestRun?
    let state: TestGroupState
}

/// State for a scenario's runs: `.pass` when the latest run has failed==0 &&
/// passed>0, `.fail` when there are runs but they aren't passing, `.none` when
/// there are no runs at all.
private func groupState(latest: TestRun?, hasRuns: Bool) -> TestGroupState {
    guard hasRuns, let latest else { return .none }
    let passing = (latest.failed ?? 0) == 0 && (latest.passed ?? 0) > 0
    return passing ? .pass : .fail
}

/// TestRun conforms to `Identified` (id) via this adapter so we can reuse
/// `latestById` (highest ULID id wins).
private struct RunId: Identified { let id: String }

private func latestRun(_ runs: [TestRun]) -> TestRun? {
    guard let id = latestById(runs.map { RunId(id: $0.id) })?.id else { return nil }
    return runs.first { $0.id == id }
}

private func makeGroup(scenarioId: String, title: String, runs: [TestRun]) -> TestGroup {
    let latest = latestRun(runs)
    return TestGroup(scenarioId: scenarioId, title: title, runs: runs,
                     latest: latest, state: groupState(latest: latest, hasRuns: !runs.isEmpty))
}

/// Ordered display groups: (1) tested vision scenarios, (2) extra scenario ids
/// that appear only in runs (not in the vision), (3) untested vision scenarios.
func buildTestGroups(scenarios: [Scenario], runs: [TestRun]) -> [TestGroup] {
    func runsFor(_ id: String) -> [TestRun] { runs.filter { $0.scenarioId == id } }

    let known = Set(scenarios.map(\.id))
    let tested = scenarios.filter { !runsFor($0.id).isEmpty }
    let untested = scenarios.filter { runsFor($0.id).isEmpty }

    // Extra scenario ids from runs not in the vision, first-seen order preserved.
    var seenExtra = Set<String>()
    var extraIds: [String] = []
    for r in runs {
        guard let id = r.scenarioId, !known.contains(id), !seenExtra.contains(id) else { continue }
        seenExtra.insert(id)
        extraIds.append(id)
    }

    return tested.map { makeGroup(scenarioId: $0.id, title: $0.title ?? $0.id, runs: runsFor($0.id)) }
        + extraIds.map { makeGroup(scenarioId: $0, title: $0, runs: runsFor($0)) }
        + untested.map { makeGroup(scenarioId: $0.id, title: $0.title ?? $0.id, runs: []) }
}
