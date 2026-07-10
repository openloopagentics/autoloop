import XCTest
@testable import Autoloop

final class DashboardFilterTests: XCTestCase {
    private func row(_ slug: String, _ status: String?) -> ProjectRow {
        ProjectRow(teamId: "t1", project: Project(slug: slug, title: nil, status: status))
    }

    func testRunningKeepsOnlyRunning() {
        let rows = [row("a", "running"), row("b", "paused"), row("c", "completed")]
        XCTAssertEqual(visibleRows(rows, filter: .running).map(\.project.slug), ["a"])
    }

    func testNilStatusExcludedUnderRunning() {
        XCTAssertTrue(visibleRows([row("a", nil)], filter: .running).isEmpty)
    }

    func testAllPassesEverythingThrough() {
        let rows = [row("a", "running"), row("b", "failed"), row("c", nil)]
        XCTAssertEqual(visibleRows(rows, filter: .all).count, 3)
    }
}
