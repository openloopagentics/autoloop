import XCTest
@testable import Autoloop

final class MapViewTests: XCTestCase {
    func testBuildMapNodesAndEdges() {
        let g = buildMap(
            goals: [MapGoal(id: "g1", title: "Goal")],
            scenarios: [MapScenario(id: "s1", title: "Scn", goalId: "g1")],
            scenarioStates: ["s1": .met],
            tasks: [MapTask(id: "t1", title: "Task", status: "running", scenarioIds: ["s1"], loopId: "L1")],
            currentTaskId: "t1",
            openBugs: [MapBug(id: "b1", title: "Bug", severity: "low", taskId: "t1", loopId: "L1")])
        XCTAssertEqual(Set(g.nodes.map(\.id)), ["g:g1", "s:s1", "t:t1", "b:b1"])
        XCTAssertEqual(g.nodes.first { $0.id == "s:s1" }?.state, .met)
        XCTAssertEqual(g.nodes.first { $0.id == "t:t1" }?.state, .active)
        XCTAssertEqual(g.nodes.first { $0.id == "t:t1" }?.loopId, "L1")
        // goal→scenario→task→bug chain
        XCTAssertTrue(g.edges.contains(MapEdge(from: "g:g1", to: "s:s1")))
        XCTAssertTrue(g.edges.contains(MapEdge(from: "s:s1", to: "t:t1")))
        XCTAssertTrue(g.edges.contains(MapEdge(from: "t:t1", to: "b:b1")))
    }

    func testHighSeverityBugMarksScenarioBugged() {
        let g = buildMap(
            goals: [], scenarios: [MapScenario(id: "s1")], scenarioStates: ["s1": .met],
            tasks: [], currentTaskId: nil,
            openBugs: [MapBug(id: "b1", severity: "high", scenarioId: "s1")])
        XCTAssertEqual(g.nodes.first { $0.id == "s:s1" }?.state, .bugged)
        // No task for the bug → it links to the scenario.
        XCTAssertTrue(g.edges.contains(MapEdge(from: "s:s1", to: "b:b1")))
    }

    func testTerminalTaskMarkedDone() {
        let g = buildMap(goals: [], scenarios: [], scenarioStates: [:],
                         tasks: [MapTask(id: "t1", status: "completed")], currentTaskId: nil, openBugs: [])
        XCTAssertEqual(g.nodes.first { $0.id == "t:t1" }?.done, true)
    }

    func testProductMapComponentWorstOf() {
        let json = #"{"nodes":[{"id":"api","label":"API","scenarioIds":["s1","s2"]}],"edges":[]}"#
        let g = buildMap(
            goals: [], scenarios: [MapScenario(id: "s1"), MapScenario(id: "s2")],
            scenarioStates: ["s1": .met, "s2": .unmet], tasks: [], currentTaskId: nil, openBugs: [],
            productMap: json)
        XCTAssertNil(g.warning)
        let comp = g.nodes.first { $0.id == "c:api" }
        XCTAssertEqual(comp?.state, .unmet)   // worst-of(met, unmet) = unmet
        XCTAssertTrue(g.edges.contains(MapEdge(from: "c:api", to: "s:s1")))
    }

    func testProductMapInvalidJsonWarns() {
        let g = buildMap(goals: [], scenarios: [], scenarioStates: [:], tasks: [], currentTaskId: nil,
                         openBugs: [], productMap: "{not json")
        XCTAssertNotNil(g.warning)
        XCTAssertFalse(g.nodes.contains { $0.type == .component })
    }

    func testProductMapBadShapeWarns() {
        let g = buildMap(goals: [], scenarios: [], scenarioStates: [:], tasks: [], currentTaskId: nil,
                         openBugs: [], productMap: #"{"nodes":[{"id":"BAD CAPS","label":"x"}]}"#)
        XCTAssertNotNil(g.warning)
    }

    func testHueForLoopDeterministicInRange() {
        let h = hueForLoop("L1")
        XCTAssertEqual(h, hueForLoop("L1"))
        XCTAssertTrue((0..<360).contains(h))
        XCTAssertNotEqual(hueForLoop("ABC"), hueForLoop("ABD"))
    }

    // MARK: - mapAtTime

    private func d(_ s: TimeInterval) -> Date { Date(timeIntervalSince1970: s) }

    func testMapAtTimeFiltersByCutoff() {
        let goals = [MapGoal(id: "g1", title: "G", createdAt: d(10))]
        let scenarios = [MapScenario(id: "s1", goalId: "g1", createdAt: d(20))]
        let slices = [MapSlice(loopId: "L1",
                               tasks: [MapTask(id: "t1", scenarioIds: ["s1"], createdAt: d(30)),
                                       MapTask(id: "t2", scenarioIds: ["s1"], createdAt: d(90))],
                               bugs: [])]
        // Cutoff 50: t1 present, t2 not yet.
        let g = mapAtTime(goals: goals, scenarios: scenarios, slices: slices, cutoff: d(50))
        XCTAssertTrue(g.nodes.contains { $0.id == "t:L1.t1" })
        XCTAssertFalse(g.nodes.contains { $0.id == "t:L1.t2" })
    }

    func testMapAtTimeBugOpenWindow() {
        let slices = [MapSlice(loopId: "L1",
                               bugs: [MapBug(id: "b1", scenarioId: "s1", status: "fixed",
                                             fixedAt: d(80), createdAt: d(10))])]
        let scenarios = [MapScenario(id: "s1", createdAt: d(5))]
        // At T=50 the bug was open (fixed only at 80) → present.
        XCTAssertTrue(mapAtTime(goals: [], scenarios: scenarios, slices: slices, cutoff: d(50))
            .nodes.contains { $0.id == "b:L1.b1" })
        // At T=90 it's fixed → gone.
        XCTAssertFalse(mapAtTime(goals: [], scenarios: scenarios, slices: slices, cutoff: d(90))
            .nodes.contains { $0.id == "b:L1.b1" })
    }
}
