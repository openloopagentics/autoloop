import Foundation
import Combine
import FirebaseFirestore

/// Loop-scoped data for the Dashboard tab.
///
/// `subscribe` (re)starts four CollectionStores scoped to the selected loop
/// (or nil for the project-direct "main" scope). Mirrors the DashboardTab
/// data wiring in the web.
@MainActor
final class DashboardTabStore: ObservableObject {
    let phases    = CollectionStore<Phase>()
    let tasks     = CollectionStore<ProjectTask>()
    let scores    = CollectionStore<Score>()
    let testRuns  = CollectionStore<TestRun>()

    private var bag: Set<AnyCancellable> = []
    // Forward nested-store changes so the view re-renders when listeners load.
    init() {
        for c in [phases.objectWillChange, tasks.objectWillChange, scores.objectWillChange, testRuns.objectWillChange] {
            c.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
        }
    }

    func subscribe(teamId: String, slug: String, loopArg: String?) {
        phases.stop()
        tasks.stop()
        scores.stop()
        testRuns.stop()

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
    }

    func stop() {
        phases.stop()
        tasks.stop()
        scores.stop()
        testRuns.stop()
    }
}
