import XCTest
@testable import Autoloop

final class AccountModelsTests: XCTestCase {
    func testMemberInviteDecode() {
        XCTAssertEqual(Member(id: "u1", data: ["role": "admin", "email": "a@x"]).role, .admin)
        XCTAssertEqual(Invite(id: "i1", teamId: "t", data: ["email": "a@x", "role": "member"]).email, "a@x")
        XCTAssertEqual(Member(id: "u2", data: [:]).role, .member)   // default
    }

    func testRestModelsDecodeJSON() throws {
        let km = try JSONDecoder().decode(KeyMeta.self, from: Data(#"{"id":"k","label":"l","prefix":"al_"}"#.utf8))
        XCTAssertEqual(km.prefix, "al_")
        let au = try JSONDecoder().decode(AdminUser.self, from: Data(#"{"uid":"u","isAllowed":true,"isAdmin":false}"#.utf8))
        XCTAssertTrue(au.isAllowed); XCTAssertNil(au.email)
    }
}
