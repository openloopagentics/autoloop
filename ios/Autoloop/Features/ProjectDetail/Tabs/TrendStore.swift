import Foundation
import FirebaseFirestore

/// Run data for the most recent TREND_LOOPS_MAX loops — the iOS port of useLoopTrend.ts.
///
/// Per loop in the window, 4 flat collections are LIVE listeners (scores/testRuns/bugs/tasks);
/// task COMMITS (nested under tasks/{id}/commits, the only place tokens persist) are one-shot
/// `getDocuments` reads re-fetched when a loop's task-id set changes — trends don't need realtime
/// token movement, and this bounds listeners at 20 × 4. `main` maps to the project-direct base.
@MainActor
final class TrendStore: ObservableObject {
    /// Windowed run data, ascending by order (main first) — feed straight into buildTrend.
    @Published private(set) var loopData: [TrendLoopData] = []
    /// Surfaces a failure from any of the fan-out snapshot listeners; nil while healthy.
    @Published var error: String?

    private struct Slice {
        var scores: [ScoreRec]?
        var testRuns: [TestRunRec]?
        var bugs: [TrendBugRec]?
        var tasks: [ProjectTask]?
        var taskCommits: [TrendCommitRec]?
    }

    private var teamId = ""
    private var slug = ""
    private var windowIds: [String] = []
    private var orderById: [String: Int] = [:]
    private var bySlice: [String: Slice] = [:]
    private var listeners: [String: ListenerRegistration] = [:]   // keyed "loopId/collection"
    private var commitTaskKey: [String: String] = [:]             // loopId → last task-id set fetched
    private let db = Firestore.firestore()

    private static let flatCollections = ["scores", "testRuns", "bugs", "tasks"]

    /// `loops` must be ascending by order (the loops query orders by "order").
    func update(teamId: String, slug: String, loops: [Loop], includeMain: Bool) {
        self.teamId = teamId
        self.slug = slug
        orderById = Dictionary(loops.compactMap { l in l.order.map { (l.id, $0) } }, uniquingKeysWith: { a, _ in a })
        let newWindow = trendWindowIds(loops.map(\.id), includeMain: includeMain)
        guard newWindow != windowIds else { return }
        windowIds = newWindow
        let keep = Set(newWindow)

        // Tear down listeners + slices for loops that left the window.
        for (key, reg) in listeners where !keep.contains(String(key.split(separator: "/")[0])) {
            reg.remove(); listeners[key] = nil
        }
        for id in bySlice.keys where !keep.contains(id) { bySlice[id] = nil; commitTaskKey[id] = nil }

        // Spin up flat-collection listeners for loops newly in the window.
        for id in newWindow {
            let loopArg = id == MAIN_ID ? nil : id
            for coll in Self.flatCollections {
                let key = "\(id)/\(coll)"
                guard listeners[key] == nil else { continue }
                let q = collectionRef(segments: basePath(teamId: teamId, slug: slug, loopId: loopArg),
                                      name: coll).order(by: FieldPath.documentID())
                listeners[key] = q.addSnapshotListener { [weak self] snap, err in
                    Task { @MainActor in
                        guard let self else { return }
                        if let err { self.error = err.localizedDescription; return }
                        self.error = nil
                        self.ingest(loopId: id, coll: coll, docs: snap?.documents ?? [])
                    }
                }
            }
        }
        publish()
    }

    private func ingest(loopId: String, coll: String, docs: [QueryDocumentSnapshot]) {
        var slice = bySlice[loopId] ?? Slice()
        switch coll {
        case "scores":   slice.scores = docs.map { Score(id: $0.documentID, data: $0.data()).asRec }
        case "testRuns": slice.testRuns = docs.map { TestRun(id: $0.documentID, data: $0.data()).asRec }
        case "bugs":     slice.bugs = docs.map { Bug(id: $0.documentID, data: $0.data()).asTrendBugRec }
        case "tasks":    slice.tasks = docs.map { ProjectTask(id: $0.documentID, data: $0.data()) }
        default: break
        }
        bySlice[loopId] = slice
        if coll == "tasks" { refetchCommits(loopId: loopId) }
        publish()
    }

    /// One-shot task-commit reads, keyed on a loop's task-id set: re-fetched only when tasks change.
    private func refetchCommits(loopId: String) {
        let tasks = bySlice[loopId]?.tasks ?? []
        let key = tasks.map(\.id).sorted().joined(separator: "+")
        guard commitTaskKey[loopId] != key else { return }
        commitTaskKey[loopId] = key
        let loopArg = loopId == MAIN_ID ? nil : loopId
        let taskIds = tasks.map(\.id)
        Task { @MainActor in
            var commits: [TrendCommitRec] = []
            for taskId in taskIds {
                let ref = collectionRef(segments: basePath(teamId: teamId, slug: slug, loopId: loopArg),
                                        name: "tasks").document(taskId).collection("commits")
                if let snap = try? await ref.getDocuments() {
                    commits.append(contentsOf: snap.documents.map {
                        Commit(id: $0.documentID, data: $0.data()).asTrendCommitRec
                    })
                }
            }
            guard commitTaskKey[loopId] == key else { return }   // a newer fetch superseded this one
            bySlice[loopId]?.taskCommits = commits
            publish()
        }
    }

    private func publish() {
        loopData = windowIds.map { id in
            let s = bySlice[id]
            return TrendLoopData(
                loopId: id,
                order: id == MAIN_ID ? nil : orderById[id],   // nil → buildTrend's MAIN_TREND_ORDER
                scores: s?.scores ?? [],
                testRuns: s?.testRuns ?? [],
                bugs: s?.bugs ?? [],
                tasks: (s?.tasks ?? []).map(\.asTrendTaskRec),
                taskCommits: s?.taskCommits ?? [])
        }
    }

    func stop() {
        listeners.values.forEach { $0.remove() }
        listeners.removeAll()
        bySlice.removeAll()
        commitTaskKey.removeAll()
        orderById.removeAll()
        windowIds = []
        loopData = []
    }
}
