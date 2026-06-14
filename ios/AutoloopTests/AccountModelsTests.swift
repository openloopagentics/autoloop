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

    /// The REST API returns Firestore Admin Timestamps as objects, not numbers — decode all shapes.
    func testKeyMetaDecodesTimestampShapes() throws {
        let obj = try JSONDecoder().decode(KeyMeta.self, from: Data(
            #"{"id":"k","label":"l","prefix":"al_","createdAt":{"_seconds":1700000000,"_nanoseconds":0}}"#.utf8))
        XCTAssertEqual(obj.createdAt, 1700000000)
        let secs = try JSONDecoder().decode(KeyMeta.self, from: Data(
            #"{"id":"k","label":"l","prefix":"al_","createdAt":{"seconds":1700000001,"nanoseconds":0}}"#.utf8))
        XCTAssertEqual(secs.createdAt, 1700000001)
        let num = try JSONDecoder().decode(KeyMeta.self, from: Data(
            #"{"id":"k","label":"l","prefix":"al_","createdAt":1700000002}"#.utf8))
        XCTAssertEqual(num.createdAt, 1700000002)
        let absent = try JSONDecoder().decode(KeyMeta.self, from: Data(#"{"id":"k","label":"l","prefix":"al_"}"#.utf8))
        XCTAssertNil(absent.createdAt)
    }
}
