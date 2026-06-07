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
