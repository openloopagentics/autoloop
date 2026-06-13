import XCTest
@testable import Autoloop

final class VerificationViewTests: XCTestCase {
    func testVerdictPicksLatestById() {
        let vs = [
            VerificationRec(id: "01", testRunId: "T1", verdict: "refuted"),
            VerificationRec(id: "02", testRunId: "T1", verdict: "confirmed"),   // latest ULID
            VerificationRec(id: "09", testRunId: "T2", verdict: "refuted"),     // other run
        ]
        XCTAssertEqual(verdictForTestRun("T1", vs), "confirmed")
        XCTAssertNil(verdictForTestRun("T3", vs))
    }

    func testScenarioVerificationOnlyCountsLatestRun() {
        let vs = [
            VerificationRec(id: "01", scenarioId: "s1", testRunId: "old", verdict: "confirmed"),
            VerificationRec(id: "02", scenarioId: "s1", testRunId: "new", verdict: "refuted"),
        ]
        // The scenario's latest run is "new" → refuted; the old run's confirmation is ignored.
        XCTAssertEqual(scenarioVerification("s1", latestTestRunId: "new", vs), "refuted")
        XCTAssertNil(scenarioVerification("s1", latestTestRunId: nil, vs))
        // A verification for another scenario doesn't leak.
        XCTAssertNil(scenarioVerification("s2", latestTestRunId: "new", vs))
    }
}
