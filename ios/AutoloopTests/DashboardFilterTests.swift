import XCTest
@testable import Autoloop

final class DashboardFilterTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func row(_ slug: String, _ status: String?) -> ProjectRow {
        ProjectRow(teamId: "t1", project: Project(slug: slug, title: nil, status: status))
    }
    /// A loop whose displayLoopStatus is genuinely "running" (fresh heartbeat, not a zombie).
    private func liveLoop(_ id: String) -> StatusLoop {
        StatusLoop(id: id, status: "running", order: 1, startedAt: now, updatedAt: now)
    }

    func testEffectiveStatusBeatsStoredInBothDirections() {
        // a: stored "running" but its loops are all done → hidden under Running.
        // b: stored "paused" but a loop is genuinely running → shown under Running.
        let rows = [row("a", "running"), row("b", "paused")]
        let loops: [String: [StatusLoop]] = [
            "t1/a": [StatusLoop(id: "l1", status: "completed", order: 1, startedAt: now, updatedAt: now)],
            "t1/b": [liveLoop("l2")],
        ]
        XCTAssertEqual(visibleRows(rows, loopsByRow: loops, filter: .running, now: now).map(\.project.slug), ["b"])
    }

    func testUnreportedRowsHiddenUnderRunning() {
        // Before a row's loops snapshot arrives, it must NOT appear under .running from a
        // stored-status guess (the reload wrong-then-corrected flash).
        let rows = [row("a", "running"), row("b", "paused")]
        XCTAssertTrue(visibleRows(rows, loopsByRow: [:], filter: .running, now: now).isEmpty)
    }

    func testReportedEmptyLoopsFallBackToStoredStatus() {
        // Once the (empty) snapshot arrives, a genuinely loop-less project uses its stored status.
        let rows = [row("a", "running"), row("b", "paused")]
        let loops: [String: [StatusLoop]] = ["t1/a": [], "t1/b": []]
        XCTAssertEqual(visibleRows(rows, loopsByRow: loops, filter: .running, now: now).map(\.project.slug), ["a"])
    }

    func testNilStoredStatusExcludedUnderRunning() {
        XCTAssertTrue(visibleRows([row("a", nil)], loopsByRow: ["t1/a": []], filter: .running, now: now).isEmpty)
    }

    func testAllPassesEverythingThrough() {
        let rows = [row("a", "running"), row("b", "failed"), row("c", nil)]
        XCTAssertEqual(visibleRows(rows, loopsByRow: ["t1/a": []], filter: .all, now: now).count, 3)
    }
}
