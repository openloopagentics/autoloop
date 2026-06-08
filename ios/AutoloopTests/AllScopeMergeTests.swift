import XCTest
@testable import Autoloop

final class AllScopeMergeTests: XCTestCase {
    func testMergeDropsRemovedScopes() {
        let by = ["__main__": [1], "L1": [2], "L2": [3]]
        let out = mergeScopes(byScope: by, current: ["__main__", "L1"]).sorted()
        XCTAssertEqual(out, [1, 2])
    }
    func testMergeEmpty() {
        XCTAssertTrue(mergeScopes(byScope: [String: [Int]](), current: []).isEmpty)
    }
}
