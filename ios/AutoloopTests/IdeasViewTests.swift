import XCTest
@testable import Autoloop

final class IdeasViewTests: XCTestCase {
    private func t(_ s: TimeInterval) -> Date { Date(timeIntervalSince1970: s) }

    func testSortBandsThenOrderThenCreatedAt() {
        let ideas = [
            IdeaRec(id: "d", status: "done", order: 0),
            IdeaRec(id: "p2", status: "proposed", order: 2, createdAt: t(100)),
            IdeaRec(id: "p1", status: "proposed", order: 1, createdAt: t(50)),
            IdeaRec(id: "a", status: "accepted", order: 5),
            IdeaRec(id: "r", status: "rejected", order: 0),
        ]
        XCTAssertEqual(sortIdeas(ideas).map(\.id), ["a", "p1", "p2", "r", "d"])
    }

    func testDefaultStatusIsProposed() {
        let ideas = [
            IdeaRec(id: "x", status: nil, order: 1),       // treated as proposed
            IdeaRec(id: "a", status: "accepted", order: 1),
        ]
        XCTAssertEqual(sortIdeas(ideas).map(\.id), ["a", "x"])
    }

    func testMoveUpSwapsOrders() {
        let ideas = [
            IdeaRec(id: "p1", status: "proposed", order: 10, createdAt: t(1)),
            IdeaRec(id: "p2", status: "proposed", order: 20, createdAt: t(2)),
        ]
        let writes = moveIdea(ideas, id: "p2", dir: .up)
        let map = Dictionary(uniqueKeysWithValues: writes.map { ($0.id, $0.order) })
        XCTAssertEqual(map["p2"], 10)
        XCTAssertEqual(map["p1"], 20)
    }

    func testMoveAtBandEdgeReturnsEmpty() {
        let ideas = [
            IdeaRec(id: "p1", status: "proposed", order: 10),
            IdeaRec(id: "p2", status: "proposed", order: 20),
        ]
        XCTAssertTrue(moveIdea(ideas, id: "p1", dir: .up).isEmpty)
        XCTAssertTrue(moveIdea(ideas, id: "p2", dir: .down).isEmpty)
        XCTAssertTrue(moveIdea(ideas, id: "missing", dir: .up).isEmpty)
    }

    func testMoveRenumbersTiedOrders() {
        // All order 100 — renumber the band 10,20,30 then swap, so reorder is not a no-op.
        let ideas = [
            IdeaRec(id: "p1", status: "proposed", order: 100, createdAt: t(1)),
            IdeaRec(id: "p2", status: "proposed", order: 100, createdAt: t(2)),
            IdeaRec(id: "p3", status: "proposed", order: 100, createdAt: t(3)),
        ]
        let writes = moveIdea(ideas, id: "p3", dir: .up)
        let map = Dictionary(uniqueKeysWithValues: writes.map { ($0.id, $0.order) })
        // p2 was position 1 (→20), p3 position 2 (→30); swap → p3 gets 20, p2 gets 30.
        XCTAssertEqual(map["p3"], 20)
        XCTAssertEqual(map["p2"], 30)
    }

    func testIdeaIdSlugifies() {
        XCTAssertEqual(ideaIdFor("Fix login flow", taken: []), "fix-login-flow")
        XCTAssertEqual(ideaIdFor("  --Trailing.. ", taken: []), "trailing")
        XCTAssertEqual(ideaIdFor("!!!", taken: []), "idea")
    }

    func testIdeaIdCollisionAppendsSuffix() {
        XCTAssertEqual(ideaIdFor("foo", taken: ["foo"], rand: { "abcd" }), "foo-abcd")
        XCTAssertEqual(ideaIdFor("foo", taken: ["bar"], rand: { "abcd" }), "foo")
    }
}
