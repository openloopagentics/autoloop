import Foundation

let MAIN_ID = "main"

/// A loop still marked "running" but untouched for this long is a zombie (ms).
let STALE_RUNNING_MS: Double = 3 * 3_600_000

/// Epoch ms from a Date (mirrors web `tsMillis` over a Firestore Timestamp / number; nil when absent).
func tsMillis(_ d: Date?) -> Double? { d.map { $0.timeIntervalSince1970 * 1000 } }

struct LoopRec { var id: String; var goal: String? = nil; var name: String? = nil
    var status: String? = nil; var order: Int? = nil
    var startedAt: Date? = nil; var updatedAt: Date? = nil
    var currentPhaseId: String? = nil; var currentTaskId: String? = nil
    var previewUrl: String? = nil }
struct ProjectRec { var slug: String; var status: String? = nil
    var currentPhaseId: String? = nil; var currentTaskId: String? = nil }
struct PhaseRec { var status: String? = nil }
struct StatusLoop { var id: String; var status: String? = nil; var order: Int? = nil
    var startedAt: Date? = nil; var updatedAt: Date? = nil }

struct SelectableLoop: Equatable {
    var id: String; var isMain: Bool
    var goal: String? = nil; var name: String? = nil; var status: String? = nil; var order: Int? = nil
    var startedAt: Date? = nil; var updatedAt: Date? = nil
    var currentPhaseId: String? = nil; var currentTaskId: String? = nil
    var previewUrl: String? = nil
}

func basePath(teamId: String, slug: String, loopId: String? = nil) -> [String] {
    let base = ["teams", teamId, "projects", slug]
    return loopId.map { base + ["loops", $0] } ?? base
}

/// Newest-iteration-first: STRICTLY startedAt desc (server-stamped truth), then order desc,
/// then descending id. No status-based reordering — a stale "running" loop must NOT outrank
/// genuinely newer iterations. The id tie-break uses Swift's `>` (Unicode-scalar order), which
/// agrees with the web's numeric localeCompare for the ULID/ASCII loop ids produced here.
private func newestFirst(_ a: (id: String, order: Int?, startedAt: Date?),
                         _ b: (id: String, order: Int?, startedAt: Date?)) -> Bool {
    let sa = tsMillis(a.startedAt) ?? 0, sb = tsMillis(b.startedAt) ?? 0
    if sa != sb { return sa > sb }
    let oa = a.order ?? 0, ob = b.order ?? 0
    if oa != ob { return oa > ob }
    return a.id > b.id
}

/// UI display status: a loop stuck "running" with no write for 3+ hours (stale pre-backstop
/// close, dead session) renders as "paused" instead of pretending an agent is live. Pure
/// presentation — the stored status is untouched. Staleness reads updatedAt, falling back to
/// startedAt.
func displayLoopStatus(status: String?, updatedAt: Date?, startedAt: Date?,
                       now: Date = Date()) -> String? {
    guard status == "running" else { return status }
    guard let last = tsMillis(updatedAt) ?? tsMillis(startedAt) else { return status }
    return now.timeIntervalSince1970 * 1000 - last > STALE_RUNNING_MS ? "paused" : status
}

/// Explicit loops (latest startedAt first) + a synthesized `main` (always last — the oldest,
/// pre-loop data) when the project has legacy project-direct data. `main` carries the PROJECT
/// doc's status/phase/task.
func buildLoopList(_ loops: [LoopRec], project: ProjectRec?, hasProjectDirectData: Bool,
                   now: Date = Date()) -> [SelectableLoop] {
    var list = loops
        .sorted { newestFirst(($0.id, $0.order, $0.startedAt), ($1.id, $1.order, $1.startedAt)) }
        .map { SelectableLoop(id: $0.id, isMain: false, goal: $0.goal, name: $0.name,
                              status: displayLoopStatus(status: $0.status, updatedAt: $0.updatedAt,
                                                        startedAt: $0.startedAt, now: now),
                              order: $0.order, startedAt: $0.startedAt, updatedAt: $0.updatedAt,
                              currentPhaseId: $0.currentPhaseId, currentTaskId: $0.currentTaskId,
                              previewUrl: $0.previewUrl) }
    if hasProjectDirectData {
        list.append(SelectableLoop(id: MAIN_ID, isMain: true, name: "main", status: project?.status,
                                   currentPhaseId: project?.currentPhaseId, currentTaskId: project?.currentTaskId))
    }
    return list
}

struct LoopGroup: Equatable { var label: String; var loops: [SelectableLoop] }

/// Group an already-newest-first loop list into runs by the calendar DAY each iteration started
/// ("Today" / "Yesterday" / a date), newest run first, iterations newest-first within each run.
/// Loops with no startedAt land in "earlier"; the synthesized `main` gets its own trailing
/// "legacy" group.
func groupLoopRuns(_ list: [SelectableLoop], now: Date = Date()) -> [LoopGroup] {
    let cal = Calendar.current
    let today = cal.startOfDay(for: now)
    let yesterday = cal.date(byAdding: .day, value: -1, to: today)!
    let fmt = DateFormatter()
    fmt.dateFormat = "EEE, MMM d, yyyy"
    func labelFor(_ d: Date) -> String {
        let day = cal.startOfDay(for: d)
        if day == today { return "Today" }
        if day == yesterday { return "Yesterday" }
        return fmt.string(from: d)
    }
    var groups: [LoopGroup] = []
    var indexByLabel: [String: Int] = [:]
    func push(_ label: String, _ loop: SelectableLoop) {
        if let i = indexByLabel[label] {
            groups[i].loops.append(loop)
        } else {
            indexByLabel[label] = groups.count
            groups.append(LoopGroup(label: label, loops: [loop]))
        }
    }
    for l in list {
        if l.isMain { push("legacy", l); continue }
        if let started = l.startedAt { push(labelFor(started), l) }
        else { push("earlier", l) }
    }
    return groups
}

/// Default selection: a valid currentLoopId → else the most-recent explicit loop → else main → else "".
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

func loopIsRunning(status: String?, updatedAt: Date? = nil, startedAt: Date? = nil,
                   now: Date = Date()) -> Bool {
    displayLoopStatus(status: status, updatedAt: updatedAt, startedAt: startedAt, now: now) == "running"
}

/// A project's effective status. "running" only when a loop is GENUINELY running (zombies display
/// as paused); otherwise the latest loop's display status. Falls back to the stored project status
/// when the project has no loops.
func effectiveProjectStatus(_ loops: [StatusLoop], projectStatus: String?, now: Date = Date()) -> String? {
    if loops.isEmpty { return projectStatus }
    if loops.contains(where: {
        displayLoopStatus(status: $0.status, updatedAt: $0.updatedAt, startedAt: $0.startedAt, now: now) == "running"
    }) { return "running" }
    let latest = loops.sorted { newestFirst(($0.id, $0.order, $0.startedAt), ($1.id, $1.order, $1.startedAt)) }.first
    let latestDisplay = latest.flatMap {
        displayLoopStatus(status: $0.status, updatedAt: $0.updatedAt, startedAt: $0.startedAt, now: now)
    }
    return latestDisplay ?? projectStatus
}

func loopArgFor(_ loop: SelectableLoop?) -> String? {
    guard let loop, !loop.isMain else { return nil }
    return loop.id
}
