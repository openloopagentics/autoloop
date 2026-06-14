import Foundation
import Combine
import FirebaseFirestore

/// Project-wide (all-scope) test runs for the Tests tab.
///
/// Tests span ALL loops, so we fan out one listener per loop id (plus the
/// project-direct "__main__" scope) via `AllScopeStore`. Mirrors VisionTabStore.
@MainActor
final class TestsTabStore: ObservableObject {
    let allTestRuns = AllScopeStore<TestRun>()

    private var bag: Set<AnyCancellable> = []
    // Forward nested-store changes so the view re-renders when listeners load.
    init() {
        allTestRuns.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
    }

    func subscribe(teamId: String, slug: String, loopIds: [String]) {
        allTestRuns.update(
            loopIds: loopIds,
            queryBuilder: { loopId in
                testRunsQuery(teamId: teamId, slug: slug, loopId: loopId)
            },
            mapper: { doc, _ in
                TestRun(id: doc.documentID, data: doc.data())
            }
        )
    }

    func stop() {
        allTestRuns.stop()
    }
}
