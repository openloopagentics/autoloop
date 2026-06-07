import XCTest
@testable import Autoloop

final class AccessGateTests: XCTestCase {
    private let u = AccessUser(uid: "u1", email: "u@x.com")

    func testLoadingUntilAuthResolves() {
        XCTAssertEqual(deriveAccess(.init(authResolved: false, user: nil, userDocResolved: false, isAllowed: false)), .loading)
    }
    func testSignedOutWhenResolvedAndNoUser() {
        XCTAssertEqual(deriveAccess(.init(authResolved: true, user: nil, userDocResolved: false, isAllowed: false)), .signedOut)
    }
    func testLoadingWhileUserDocUnresolved() {
        XCTAssertEqual(deriveAccess(.init(authResolved: true, user: u, userDocResolved: false, isAllowed: false)), .loading)
    }
    func testAllowedWhenDocResolvedAndAllowed() {
        XCTAssertEqual(deriveAccess(.init(authResolved: true, user: u, userDocResolved: true, isAllowed: true)), .allowed)
    }
    func testPendingWhenDocResolvedButNotAllowed() {
        XCTAssertEqual(deriveAccess(.init(authResolved: true, user: u, userDocResolved: true, isAllowed: false)), .pending)
    }
}
