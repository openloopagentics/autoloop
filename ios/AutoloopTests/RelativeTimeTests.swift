import XCTest
@testable import Autoloop

final class RelativeTimeTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)
    private func ago(_ seconds: TimeInterval) -> Date { now.addingTimeInterval(-seconds) }

    func testNilAndJustNow() {
        XCTAssertEqual(relativeTime(nil, now: now), "")
        XCTAssertEqual(relativeTime(ago(10), now: now), "just now")     // < 1 min
        XCTAssertEqual(relativeTime(now, now: now), "just now")
    }

    func testMinutes() {
        XCTAssertEqual(relativeTime(ago(5 * 60), now: now), "5m ago")
        XCTAssertEqual(relativeTime(ago(59 * 60), now: now), "59m ago")
    }

    func testHours() {
        XCTAssertEqual(relativeTime(ago(3 * 3600), now: now), "3h ago")
        XCTAssertEqual(relativeTime(ago(23 * 3600), now: now), "23h ago")
    }

    func testDays() {
        XCTAssertEqual(relativeTime(ago(2 * 86400), now: now), "2d ago")
    }
}
