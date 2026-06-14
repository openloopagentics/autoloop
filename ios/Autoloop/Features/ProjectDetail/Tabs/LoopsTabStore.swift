import Foundation
import Combine
import FirebaseFirestore

/// Loop-scoped data for the SELECTED loop in the Loops tab.
///
/// Owns the selected loop's phases/tasks/testRuns/revisions (plus scores, so
/// the selected row can show its scenarios-met count). `subscribe` re-starts
/// every store scoped to the selected loop arg (or nil for the legacy "main"
/// project-direct scope). Mirrors the per-loop data the web's `LoopDetail`
/// renders; non-selected rows stay light (no listeners) — see LoopsTabView.
@MainActor
final class LoopsTabStore: ObservableObject {
    let phases    = CollectionStore<Phase>()
    let tasks     = CollectionStore<ProjectTask>()
    let scores    = CollectionStore<Score>()
    let testRuns  = CollectionStore<TestRun>()
    let revisions = CollectionStore<Revision>()

    private var bag: Set<AnyCancellable> = []
    // Forward nested-store changes so the view re-renders when listeners load.
    init() {
        for c in [phases.objectWillChange, tasks.objectWillChange, scores.objectWillChange,
                  testRuns.objectWillChange, revisions.objectWillChange] {
            c.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
        }
    }

    func subscribe(teamId: String, slug: String, loopArg: String?) {
        stop()
        phases.start(query: phasesQuery(teamId: teamId, slug: slug, loopId: loopArg)) {
            Phase(id: $0.documentID, data: $0.data())
        }
        tasks.start(query: tasksQuery(teamId: teamId, slug: slug, loopId: loopArg)) {
            ProjectTask(id: $0.documentID, data: $0.data())
        }
        scores.start(query: scoresQuery(teamId: teamId, slug: slug, loopId: loopArg)) {
            Score(id: $0.documentID, data: $0.data())
        }
        testRuns.start(query: testRunsQuery(teamId: teamId, slug: slug, loopId: loopArg)) {
            TestRun(id: $0.documentID, data: $0.data())
        }
        revisions.start(query: revisionsQuery(teamId: teamId, slug: slug, loopId: loopArg)) {
            Revision(id: $0.documentID, data: $0.data())
        }
    }

    func stop() {
        phases.stop()
        tasks.stop()
        scores.stop()
        testRuns.stop()
        revisions.stop()
    }
}

/// Lazy commits loader for a single phase or task (created when a row expands).
/// Wraps one CollectionStore against the relevant `commits` subcollection.
@MainActor
final class CommitsStore: ObservableObject {
    let commits = CollectionStore<Commit>()
    private var started = false

    func startTask(teamId: String, slug: String, taskId: String, loopArg: String?) {
        guard !started else { return }
        started = true
        commits.start(query: taskCommitsQuery(teamId: teamId, slug: slug, taskId: taskId, loopId: loopArg)) {
            Commit(id: $0.documentID, data: $0.data())
        }
    }

    func startPhase(teamId: String, slug: String, phaseId: String, loopArg: String?) {
        guard !started else { return }
        started = true
        commits.start(query: commitsQuery(teamId: teamId, slug: slug, phaseId: phaseId, loopId: loopArg)) {
            Commit(id: $0.documentID, data: $0.data())
        }
    }

    func stop() { commits.stop(); started = false }
}
