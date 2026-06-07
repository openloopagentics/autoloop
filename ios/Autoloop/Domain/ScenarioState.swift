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
