import XCTest
@testable import Autoloop

final class AuthoringLogicTests: XCTestCase {
    func testSlugify() {
        XCTAssertEqual(slugify("Hello World!"), "hello-world")
        XCTAssertEqual(slugify("  A.B_c-d  "), "a.b_c-d")
    }

    func testGenIdDedupes() {
        XCTAssertEqual(genId(title: "Goal", taken: [], prefix: "g"), "goal")
        XCTAssertEqual(genId(title: "Goal", taken: ["goal"], prefix: "g"), "goal-2")
        XCTAssertEqual(genId(title: "", taken: ["g"], prefix: "g"), "g-2")
    }

    func testIsValidSlug() {
        XCTAssertTrue(isValidSlug("web-1.0_x")); XCTAssertFalse(isValidSlug("Web Site")); XCTAssertFalse(isValidSlug(""))
    }

    func testBuildRubricCriteria() {
        let rows = [CriterionRow(name: "Speed", weight: "2", max: "5"), CriterionRow(name: "Speed", weight: "1", max: "5")]
        let c = buildRubricCriteria(rows)
        XCTAssertEqual(c.count, 2); XCTAssertNotEqual(c[0].id, c[1].id)
        XCTAssertEqual(c[0].name, "Speed"); XCTAssertEqual(c[0].weight, 2)
    }

    func testRowIsValid() {
        XCTAssertTrue(rowIsValid(CriterionRow(name: "n", weight: "1", max: "5")))
        XCTAssertFalse(rowIsValid(CriterionRow(name: "", weight: "1", max: "5")))
        XCTAssertFalse(rowIsValid(CriterionRow(name: "n", weight: "0", max: "5")))
        XCTAssertFalse(rowIsValid(CriterionRow(name: "n", weight: "1", max: "0")))
    }
}
