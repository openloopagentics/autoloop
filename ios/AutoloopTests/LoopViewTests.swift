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

    // MARK: - SP4 web parity: startedAt ordering, zombie display, day grouping

    private let now = Date(timeIntervalSince1970: 1_700_000_000)
    private func ago(_ hours: Double) -> Date { now.addingTimeInterval(-hours * 3600) }

    func testStartedAtDrivesOrderingOverOrder() {
        // b has a lower order but a LATER startedAt → b ranks first (startedAt is the truth).
        let loops = [
            LoopRec(id: "a", order: 5, startedAt: ago(10)),
            LoopRec(id: "b", order: 1, startedAt: ago(2)),
        ]
        let list = buildLoopList(loops, project: nil, hasProjectDirectData: false, now: now)
        XCTAssertEqual(list.map(\.id), ["b", "a"])
    }

    func testZombieRunningRendersPaused() {
        let stale = LoopRec(id: "a", status: "running", order: 2, startedAt: ago(10), updatedAt: ago(4))
        let live = LoopRec(id: "b", status: "running", order: 1, startedAt: ago(1), updatedAt: ago(1))
        let list = buildLoopList([stale, live], project: nil, hasProjectDirectData: false, now: now)
        XCTAssertEqual(list.first(where: { $0.id == "a" })?.status, "paused")
        XCTAssertEqual(list.first(where: { $0.id == "b" })?.status, "running")
    }

    func testDisplayLoopStatusFallsBackToStartedAt() {
        // No updatedAt → staleness reads startedAt.
        XCTAssertEqual(displayLoopStatus(status: "running", updatedAt: nil, startedAt: ago(4), now: now), "paused")
        XCTAssertEqual(displayLoopStatus(status: "running", updatedAt: nil, startedAt: ago(1), now: now), "running")
        // Non-running statuses pass through untouched.
        XCTAssertEqual(displayLoopStatus(status: "completed", updatedAt: ago(99), startedAt: nil, now: now), "completed")
    }

    func testEffectiveStatusIgnoresZombieRunning() {
        // The only "running" loop is a zombie → effective status is NOT running.
        let zombie = StatusLoop(id: "x", status: "running", order: 1, startedAt: ago(10), updatedAt: ago(5))
        XCTAssertNotEqual(effectiveProjectStatus([zombie], projectStatus: nil, now: now), "running")
    }

    func testGroupLoopRunsBucketsByDay() {
        let cal = Calendar.current
        let yesterdaySameTime = cal.date(byAdding: .day, value: -1, to: now)!
        let loops = [
            LoopRec(id: "t1", order: 3, startedAt: now),               // today
            LoopRec(id: "y1", order: 2, startedAt: yesterdaySameTime), // yesterday
            LoopRec(id: "n0", order: 1, startedAt: nil),               // earlier
        ]
        let list = buildLoopList(loops, project: ProjectRec(slug: "s", status: "completed"),
                                 hasProjectDirectData: true, now: now)
        let groups = groupLoopRuns(list, now: now)
        XCTAssertEqual(groups.first?.label, "Today")
        XCTAssertEqual(groups.first?.loops.map(\.id), ["t1"])
        XCTAssertTrue(groups.contains { $0.label == "Yesterday" && $0.loops.map(\.id) == ["y1"] })
        XCTAssertTrue(groups.contains { $0.label == "earlier" && $0.loops.map(\.id) == ["n0"] })
        XCTAssertEqual(groups.last?.label, "legacy")
        XCTAssertTrue(groups.last?.loops.first?.isMain == true)
    }
}
