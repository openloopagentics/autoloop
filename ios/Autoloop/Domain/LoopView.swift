import Foundation

let MAIN_ID = "main"

struct LoopRec { var id: String; var goal: String? = nil; var name: String? = nil
    var status: String? = nil; var order: Int? = nil
    var currentPhaseId: String? = nil; var currentTaskId: String? = nil }
struct ProjectRec { var slug: String; var status: String? = nil
    var currentPhaseId: String? = nil; var currentTaskId: String? = nil }
struct PhaseRec { var status: String? = nil }
struct StatusLoop { var id: String; var status: String? = nil; var order: Int? = nil }

struct SelectableLoop: Equatable {
    var id: String; var isMain: Bool
    var goal: String? = nil; var name: String? = nil; var status: String? = nil; var order: Int? = nil
    var currentPhaseId: String? = nil; var currentTaskId: String? = nil
}

func basePath(teamId: String, slug: String, loopId: String? = nil) -> [String] {
    let base = ["teams", teamId, "projects", slug]
    return loopId.map { base + ["loops", $0] } ?? base
}

private func descByOrderThenId<T>(_ a: T, _ b: T, order: (T) -> Int?, id: (T) -> String) -> Bool {
    let oa = order(a) ?? 0, ob = order(b) ?? 0
    if oa != ob { return oa > ob }
    return id(a) > id(b)
}

func buildLoopList(_ loops: [LoopRec], project: ProjectRec?, hasProjectDirectData: Bool) -> [SelectableLoop] {
    var list = loops
        .sorted { descByOrderThenId($0, $1, order: { $0.order }, id: { $0.id }) }
        .map { SelectableLoop(id: $0.id, isMain: false, goal: $0.goal, name: $0.name,
                              status: $0.status, order: $0.order,
                              currentPhaseId: $0.currentPhaseId, currentTaskId: $0.currentTaskId) }
    if hasProjectDirectData {
        list.append(SelectableLoop(id: MAIN_ID, isMain: true, name: "main", status: project?.status,
                                   currentPhaseId: project?.currentPhaseId, currentTaskId: project?.currentTaskId))
    }
    return list
}

func defaultSelectedLoop(_ list: [SelectableLoop], currentLoopId: String?) -> String {
    if list.isEmpty { return "" }
    if let c = currentLoopId, list.contains(where: { $0.id == c }) { return c }
    let explicit = list.filter { !$0.isMain }
    if let first = explicit.first { return first.id }
    return list[list.count - 1].id
}

func phaseProgress(_ phases: [PhaseRec]) -> (done: Int, total: Int) {
    let done = phases.filter { ($0.status).map(isTerminalStatus) ?? false }.count
    return (done, phases.count)
}

func loopIsRunning(_ status: String?) -> Bool { status == "running" }

func effectiveProjectStatus(_ loops: [StatusLoop], projectStatus: String?) -> String? {
    if loops.isEmpty { return projectStatus }
    if loops.contains(where: { $0.status == "running" }) { return "running" }
    let latest = loops.sorted { descByOrderThenId($0, $1, order: { $0.order }, id: { $0.id }) }.first
    return latest?.status ?? projectStatus
}

func loopArgFor(_ loop: SelectableLoop?) -> String? {
    guard let loop, !loop.isMain else { return nil }
    return loop.id
}
