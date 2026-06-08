import Foundation
import FirebaseFirestore

/// Project-wide (all-scope) scores + testRuns for the Vision tab.
///
/// Met-state spans ALL loops, so we use `AllScopeStore` rather than a
/// loop-scoped `CollectionStore`. `subscribe` fans out one listener per
/// loop id (plus the project-direct "__main__" scope).
@MainActor
final class VisionTabStore: ObservableObject {
    let allScores    = AllScopeStore<Score>()
    let allTestRuns  = AllScopeStore<TestRun>()

    func subscribe(teamId: String, slug: String, loopIds: [String]) {
        allScores.update(
            loopIds: loopIds,
            queryBuilder: { loopId in
                scoresQuery(teamId: teamId, slug: slug, loopId: loopId)
            },
            mapper: { doc, _ in
                Score(id: doc.documentID, data: doc.data())
            }
        )
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
        allScores.stop()
        allTestRuns.stop()
    }
}
