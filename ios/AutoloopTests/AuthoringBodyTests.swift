import XCTest
@testable import Autoloop

final class AuthoringBodyTests: XCTestCase {
    func testGoalBodyOmitsNils() {
        let o = GoalBody(title: "T", description: nil, order: nil).jsonObject
        XCTAssertEqual(o["title"] as? String, "T")
        XCTAssertNil(o["description"]); XCTAssertNil(o["order"])
    }

    func testGoalBodyIncludesSet() {
        let o = GoalBody(title: "T", description: "d", order: 3).jsonObject
        XCTAssertEqual(o["description"] as? String, "d"); XCTAssertEqual(o["order"] as? Int, 3)
    }

    func testScenarioBodyNestsRubric() {
        let o = ScenarioBody(goalId: "g", title: "T", description: nil, order: nil, threshold: 80,
            rubric: RubricBody(criteria: [RubricCriterionBody(id: "c1", name: "n", weight: 1, max: 5)])).jsonObject
        XCTAssertEqual(o["threshold"] as? Int, 80)
        let crit = ((o["rubric"] as? [String: Any])?["criteria"] as? [[String: Any]])
        XCTAssertEqual(crit?.first?["name"] as? String, "n")
        XCTAssertNil(o["description"])
    }

    func testDocumentBody() {
        let o = DocumentBody(kind: "spec", title: "T", format: "markdown", content: "x").jsonObject
        XCTAssertEqual(o["format"] as? String, "markdown")
    }
}
