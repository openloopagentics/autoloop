import Foundation
import FirebaseFirestore

/// Run-data slices for the product map — the iOS port of MapTab's useLoopTrend fetch layer.
///
/// One MapSlice per loop in the trend window (incl. project-direct `main`): tasks/bugs/scores/
/// testRuns as LIVE listeners (4 × ≤20). The same slices feed both the live map (flattened for
/// project-wide scenario states + the selected loop's tasks/bugs) and the growth-replay scrubber
/// (mapAtTime over all slices). Mirrors TrendStore's fan-out, but carries createdAt + full fields.
@MainActor
final class MapTabStore: ObservableObject {
    @Published private(set) var slices: [MapSlice] = []

    private struct Raw {
        var tasks: [MapTask]?
        var bugs: [MapBug]?
        var scores: [ScoreRec]?
        var testRuns: [TestRunRec]?
    }

    private var teamId = ""
    private var slug = ""
    private var windowIds: [String] = []
    private var raw: [String: Raw] = [:]
    private var listeners: [String: ListenerRegistration] = [:]
    private let flatCollections = ["tasks", "bugs", "scores", "testRuns"]

    func update(teamId: String, slug: String, loops: [Loop], includeMain: Bool) {
        self.teamId = teamId
        self.slug = slug
        let newWindow = trendWindowIds(loops.map(\.id), includeMain: includeMain)
        guard newWindow != windowIds else { return }
        windowIds = newWindow
        let keep = Set(newWindow)
        for (key, reg) in listeners where !keep.contains(String(key.split(separator: "/")[0])) {
            reg.remove(); listeners[key] = nil
        }
        for id in raw.keys where !keep.contains(id) { raw[id] = nil }
        for id in newWindow {
            let loopArg = id == MAIN_ID ? nil : id
            for coll in flatCollections {
                let key = "\(id)/\(coll)"
                guard listeners[key] == nil else { continue }
                let q = collectionRef(segments: basePath(teamId: teamId, slug: slug, loopId: loopArg),
                                      name: coll).order(by: FieldPath.documentID())
                listeners[key] = q.addSnapshotListener { [weak self] snap, _ in
                    Task { @MainActor in self?.ingest(id, coll, snap?.documents ?? []) }
                }
            }
        }
        publish()
    }

    private func ingest(_ loopId: String, _ coll: String, _ docs: [QueryDocumentSnapshot]) {
        var r = raw[loopId] ?? Raw()
        switch coll {
        case "tasks":
            r.tasks = docs.map { let t = ProjectTask(id: $0.documentID, data: $0.data())
                return MapTask(id: t.id, title: t.title, status: t.status, scenarioIds: t.scenarioIds, createdAt: t.createdAt) }
        case "bugs":
            r.bugs = docs.map { let b = Bug(id: $0.documentID, data: $0.data())
                return MapBug(id: b.id, title: b.title, severity: b.severity, scenarioId: b.scenarioId,
                              taskId: b.taskId, status: b.status, fixedAt: b.fixedAt, createdAt: b.createdAt) }
        case "scores":
            r.scores = docs.map { let s = Score(id: $0.documentID, data: $0.data())
                return ScoreRec(id: s.id, scenarioId: s.scenarioId, composite: s.composite, createdAt: s.createdAt) }
        case "testRuns":
            r.testRuns = docs.map { let t = TestRun(id: $0.documentID, data: $0.data())
                return TestRunRec(id: t.id, scenarioId: t.scenarioId, failed: t.failed, createdAt: t.createdAt) }
        default: break
        }
        raw[loopId] = r
        publish()
    }

    private func publish() {
        slices = windowIds.map { id in
            let r = raw[id]
            return MapSlice(loopId: id == MAIN_ID ? nil : id,
                            tasks: r?.tasks ?? [], bugs: r?.bugs ?? [],
                            scores: r?.scores ?? [], testRuns: r?.testRuns ?? [])
        }
    }

    /// The slice for a given selectable loop (loopArg: nil = project-direct main).
    func slice(loopArg: String?) -> MapSlice? {
        slices.first { $0.loopId == loopArg }
    }

    func stop() {
        listeners.values.forEach { $0.remove() }
        listeners.removeAll()
        raw.removeAll()
        windowIds = []
        slices = []
    }
}
