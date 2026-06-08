import Foundation
import FirebaseFirestore

/// Project-wide (all-scope) test runs for the Tests tab.
///
/// Tests span ALL loops, so we fan out one listener per loop id (plus the
/// project-direct "__main__" scope) via `AllScopeStore`. Mirrors VisionTabStore.
@MainActor
final class TestsTabStore: ObservableObject {
    let allTestRuns = AllScopeStore<TestRun>()

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
