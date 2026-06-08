import XCTest
@testable import Autoloop

final class RecBridgeTests: XCTestCase {
    func testLoopToRecAndStatusLoop() {
        let l = Loop(id: "L1", data: ["goal": "g", "status": "running", "order": 2])
        XCTAssertEqual(l.asLoopRec.status, "running")
        XCTAssertEqual(l.asStatusLoop.order, 2)
    }
    func testScenarioScoreTestRunRecs() {
        XCTAssertEqual(Scenario(id: "s1", data: ["threshold": 70]).asRec.threshold, 70)
        XCTAssertEqual(Score(id: "01", data: ["scenarioId": "s1", "composite": 88.0]).asRec.composite, 88)
        XCTAssertEqual(TestRun(id: "01", data: ["scenarioId": "s1", "failed": 0]).asRec.failed, 0)
    }
}
