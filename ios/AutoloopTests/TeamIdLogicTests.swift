import XCTest
@testable import Autoloop

final class TeamIdLogicTests: XCTestCase {
    func testSlugify() {
        XCTAssertEqual(slugifyTeam("My Team!"), "my-team")
        XCTAssertEqual(slugifyTeam("--..x.."), "x")
        XCTAssertEqual(slugifyTeam("!!!"), "team")
    }

    func testTeamIdFromName() {
        XCTAssertEqual(teamIdFromName("My Team", suffix: { "ab12" }), "my-team-ab12")
    }
}
