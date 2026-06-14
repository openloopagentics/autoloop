import XCTest
@testable import Autoloop

final class TestsLogicTests: XCTestCase {
    func testExtraScenariosFromRunsAppear() {
        let scns = [Scenario(id: "s1", data: [:])]
        let runs = [TestRun(id: "01", data: ["scenarioId": "s1", "passed": 1, "failed": 0]),
                    TestRun(id: "02", data: ["scenarioId": "x9", "passed": 0, "failed": 1])]
        let g = buildTestGroups(scenarios: scns, runs: runs)
        XCTAssertEqual(g.map(\.scenarioId), ["s1", "x9"])  // tested, then extra
        XCTAssertEqual(g[0].state, .pass); XCTAssertEqual(g[1].state, .fail)
    }

    func testUntestedLast() {
        let g = buildTestGroups(scenarios: [Scenario(id: "a", data: [:]), Scenario(id: "b", data: [:])],
                                runs: [TestRun(id: "01", data: ["scenarioId": "a", "passed": 1, "failed": 0])])
        XCTAssertEqual(g.map(\.scenarioId), ["a", "b"]); XCTAssertEqual(g[1].state, .none)
    }
}
