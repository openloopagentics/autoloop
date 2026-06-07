import XCTest
@testable import Autoloop

final class LoopViewTests: XCTestCase {
    func testBasePath() {
        XCTAssertEqual(basePath(teamId: "t", slug: "s"), ["teams", "t", "projects", "s"])
        XCTAssertEqual(basePath(teamId: "t", slug: "s", loopId: "L1"),
                       ["teams", "t", "projects", "s", "loops", "L1"])
    }

    func testBuildLoopListSortsDescAndAppendsMain() {
        let loops = [LoopRec(id: "a", order: 1), LoopRec(id: "b", order: 2)]
        let proj = ProjectRec(slug: "s", status: "running")
        let list = buildLoopList(loops, project: proj, hasProjectDirectData: true)
        XCTAssertEqual(list.map(\.id), ["b", "a", "main"])
        XCTAssertTrue(list.last!.isMain)
        XCTAssertEqual(list.last!.status, "running")
    }

    func testDefaultSelectedLoopPrefersValidCurrent() {
        let list = buildLoopList([LoopRec(id: "a", order: 1)], project: nil, hasProjectDirectData: false)
        XCTAssertEqual(defaultSelectedLoop(list, currentLoopId: "a"), "a")
        XCTAssertEqual(defaultSelectedLoop(list, currentLoopId: "missing"), "a")
        XCTAssertEqual(defaultSelectedLoop([], currentLoopId: "a"), "")
    }

    func testPhaseProgressCountsTerminal() {
        let phases = [PhaseRec(status: "completed"), PhaseRec(status: "running"), PhaseRec(status: "failed")]
        let p = phaseProgress(phases)
        XCTAssertEqual(p.done, 2); XCTAssertEqual(p.total, 3)
    }

    func testEffectiveProjectStatus() {
        XCTAssertEqual(effectiveProjectStatus([], projectStatus: "completed"), "completed")
        XCTAssertEqual(effectiveProjectStatus([("x", "queued", 1), ("y", "running", 0)].map(asLoop),
                                              projectStatus: "completed"), "running")
        XCTAssertEqual(effectiveProjectStatus([("x", "completed", 2), ("y", "failed", 1)].map(asLoop),
                                              projectStatus: nil), "completed")
    }

    private func asLoop(_ t: (String, String, Int)) -> StatusLoop {
        StatusLoop(id: t.0, status: t.1, order: t.2)
    }
}
