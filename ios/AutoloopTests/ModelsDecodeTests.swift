import XCTest
@testable import Autoloop

final class ModelsDecodeTests: XCTestCase {
    func testProjectFromFirestoreDict() {
        let doc: [String: Any] = ["title": "Demo", "status": "running", "extra": 42]
        let p = Project(slug: "demo", data: doc)
        XCTAssertEqual(p.slug, "demo")
        XCTAssertEqual(p.title, "Demo")
        XCTAssertEqual(p.status, "running")
    }
    func testProjectToleratesMissingFields() {
        let p = Project(slug: "x", data: [:])
        XCTAssertEqual(p.slug, "x")
        XCTAssertNil(p.title)
        XCTAssertNil(p.status)
    }
    func testTeamRefFromMemberDoc() {
        let t = TeamRef(teamId: "t1", data: ["role": "owner"])
        XCTAssertEqual(t.teamId, "t1"); XCTAssertEqual(t.role, "owner")
    }
}
