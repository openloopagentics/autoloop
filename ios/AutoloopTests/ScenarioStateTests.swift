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
