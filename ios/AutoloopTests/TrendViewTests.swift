import XCTest
import CoreGraphics
@testable import Autoloop

final class TrendViewTests: XCTestCase {
    func testTrendWindowPrependsMainAndCaps() {
        let ids = (1...25).map { "L\($0)" }
        let win = trendWindowIds(ids, includeMain: true)
        XCTAssertEqual(win.count, TREND_LOOPS_MAX)
        // main is prepended then the whole thing capped to the most recent 20 → main falls off.
        XCTAssertEqual(win.first, "L6")   // 26 combined [main,L1..L25], suffix 20 → first kept is L6
        XCTAssertEqual(win.last, "L25")
    }

    func testTrendWindowKeepsMainWhenRoom() {
        let win = trendWindowIds(["L1", "L2"], includeMain: true)
        XCTAssertEqual(win, [MAIN_ID, "L1", "L2"])
    }

    func testBuildTrendCountsMetTaggedScenariosOnly() {
        // Scenario s1 tagged by the loop's task and met; s2 not tagged → excluded from totals.
        let scenarios = [ScenarioRec(id: "s1", threshold: 80), ScenarioRec(id: "s2", threshold: 80)]
        let loop = TrendLoopData(
            loopId: "L1", order: 1,
            scores: [ScoreRec(id: "01", scenarioId: "s1", composite: 90)],
            testRuns: [TestRunRec(id: "01", scenarioId: "s1", failed: 0)],
            bugs: [TrendBugRec(status: "open"), TrendBugRec(status: "fixed")],
            tasks: [TrendTaskRec(scenarioIds: ["s1"])],
            taskCommits: [TrendCommitRec(tokensTotal: 100), TrendCommitRec(tokensTotal: nil)])
        let pts = buildTrend([loop], scenarios: scenarios)
        XCTAssertEqual(pts.count, 1)
        XCTAssertEqual(pts[0].metCount, 1)
        XCTAssertEqual(pts[0].scenarioTotal, 1)
        XCTAssertEqual(pts[0].avgComposite, 90)
        XCTAssertEqual(pts[0].bugsOpened, 2)
        XCTAssertEqual(pts[0].bugsFixed, 1)
        XCTAssertEqual(pts[0].tokensTotal, 100)   // missing tokens ⇒ 0
    }

    func testBuildTrendNoTaggedScenarios() {
        let loop = TrendLoopData(loopId: "L1", order: 1, tasks: [TrendTaskRec(scenarioIds: nil)])
        let pts = buildTrend([loop], scenarios: [ScenarioRec(id: "s1")])
        XCTAssertEqual(pts[0].scenarioTotal, 0)
        XCTAssertNil(pts[0].avgComposite)
    }

    func testBuildTrendSortsByOrderMainFirst() {
        let main = TrendLoopData(loopId: "main", order: nil)
        let l2 = TrendLoopData(loopId: "L2", order: 2)
        let l1 = TrendLoopData(loopId: "L1", order: 1)
        let pts = buildTrend([l2, main, l1], scenarios: [])
        XCTAssertEqual(pts.map(\.loopId), ["main", "L1", "L2"])
        XCTAssertEqual(pts[0].order, MAIN_TREND_ORDER)
    }

    func testPolylinePointsSpreadAndInvert() {
        // Two points 0 and 10 over width 100, height 32, pad 2: first at x=2 (max→top y=2),
        // last at x=98 (min→bottom y=30).
        let pts = polylinePoints([0, 10], width: 100, height: 32, pad: 2)
        XCTAssertEqual(pts.count, 2)
        XCTAssertEqual(pts[0].x, 2, accuracy: 0.01)
        XCTAssertEqual(pts[0].y, 30, accuracy: 0.01)   // value 0 = min → bottom
        XCTAssertEqual(pts[1].x, 98, accuracy: 0.01)
        XCTAssertEqual(pts[1].y, 2, accuracy: 0.01)    // value 10 = max → top
    }

    func testPolylineFlatSeriesMidHeight() {
        let pts = polylinePoints([5, 5, 5], width: 100, height: 32)
        XCTAssertTrue(pts.allSatisfy { abs($0.y - 16) < 0.01 })
    }

    func testPolylineSkipsNils() {
        XCTAssertEqual(polylinePoints([nil, nil], width: 100, height: 32), [])
    }
}
