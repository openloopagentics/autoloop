import Foundation

/// Growth-replay: the product map as of time T — mirrors web mapTimeline.ts.

/// One loop's run data (loopId nil = project-direct "main").
struct MapSlice {
    var loopId: String? = nil
    var tasks: [MapTask] = []
    var bugs: [MapBug] = []
    var scores: [ScoreRec] = []     // carry createdAt
    var testRuns: [TestRunRec] = [] // carry createdAt
}

/// Missing createdAt (legacy data) ⇒ treated as always-present, keeping growth monotonic.
private func within(_ cutoff: Date, _ createdAt: Date?) -> Bool {
    guard let t = tsMillis(createdAt) else { return true }
    return t <= cutoff.timeIntervalSince1970 * 1000
}

/// Cross-loop ids can collide (each loop names its own tasks/bugs); scope merged ids by loop.
private func scoped(_ loopId: String?, _ id: String) -> String { loopId.map { "\($0).\(id)" } ?? id }

/// The graph as of time T: entities filtered to createdAt <= T; scenario met-state evaluated over
/// only the events with createdAt <= T. Bugs render while open at T (created <= T and not yet fixed
/// at T) — the one sanctioned exception to monotonic growth, mirroring the live open-bugs rule.
func mapAtTime(goals: [MapGoal], scenarios: [MapScenario], slices: [MapSlice], cutoff: Date) -> MapGraph {
    let goalsT = goals.filter { within(cutoff, $0.createdAt) }
    let scenariosT = scenarios.filter { within(cutoff, $0.createdAt) }
    let scoresT = slices.flatMap { $0.scores }.filter { within(cutoff, $0.createdAt) }
    let runsT = slices.flatMap { $0.testRuns }.filter { within(cutoff, $0.createdAt) }

    var scenarioStates: [String: MapNodeState] = [:]
    for s in scenariosT {
        let st = deriveScenarioState(ScenarioRec(id: s.id, threshold: s.threshold), scores: scoresT, testRuns: runsT)
        scenarioStates[s.id] = st.state == .met ? .met : .unmet
    }

    let tasksT: [MapTask] = slices.flatMap { sl in
        sl.tasks.filter { within(cutoff, $0.createdAt) }.map { t in
            var t = t; t.id = scoped(sl.loopId, t.id); t.loopId = sl.loopId; return t
        }
    }
    func openAtT(_ b: MapBug) -> Bool {
        guard within(cutoff, b.createdAt) else { return false }
        if b.status != "fixed" { return true }
        guard let fixed = tsMillis(b.fixedAt) else { return true }
        return fixed > cutoff.timeIntervalSince1970 * 1000
    }
    let bugsT: [MapBug] = slices.flatMap { sl in
        sl.bugs.filter(openAtT).map { b in
            var b = b
            b.id = scoped(sl.loopId, b.id)
            if let tid = b.taskId { b.taskId = scoped(sl.loopId, tid) }
            b.loopId = sl.loopId
            return b
        }
    }

    return buildMap(goals: goalsT, scenarios: scenariosT, scenarioStates: scenarioStates,
                    tasks: tasksT, currentTaskId: nil, openBugs: bugsT)
}
