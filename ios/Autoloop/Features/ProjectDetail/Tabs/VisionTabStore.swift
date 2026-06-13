import Foundation
import FirebaseFirestore

/// Project-wide (all-scope) scores + testRuns for the Vision tab.
///
/// Met-state spans ALL loops, so we use `AllScopeStore` rather than a
/// loop-scoped `CollectionStore`. `subscribe` fans out one listener per
/// loop id (plus the project-direct "__main__" scope).
@MainActor
final class VisionTabStore: ObservableObject {
    let allScores       = AllScopeStore<Score>()
    let allTestRuns     = AllScopeStore<TestRun>()
    let allVerifications = AllScopeStore<Verification>()   // loop-scoped evidence
    let visionChanges   = CollectionStore<VisionChange>()  // project-direct, ULID desc

    @Published var rejectError: String?
    private var teamId = ""
    private var slug = ""

    func subscribe(teamId: String, slug: String, loopIds: [String]) {
        self.teamId = teamId
        self.slug = slug
        allScores.update(
            loopIds: loopIds,
            queryBuilder: { loopId in scoresQuery(teamId: teamId, slug: slug, loopId: loopId) },
            mapper: { doc, _ in Score(id: doc.documentID, data: doc.data()) }
        )
        allTestRuns.update(
            loopIds: loopIds,
            queryBuilder: { loopId in testRunsQuery(teamId: teamId, slug: slug, loopId: loopId) },
            mapper: { doc, _ in TestRun(id: doc.documentID, data: doc.data()) }
        )
        allVerifications.update(
            loopIds: loopIds,
            queryBuilder: { loopId in verificationsQuery(teamId: teamId, slug: slug, loopId: loopId) },
            mapper: { doc, _ in Verification(id: doc.documentID, data: doc.data()) }
        )
        visionChanges.start(query: visionChangesQuery(teamId: teamId, slug: slug)) {
            VisionChange(id: $0.documentID, data: $0.data())
        }
    }

    func reject(_ id: String) async {
        rejectError = nil
        do { try await RestClient.rejectVisionChange(teamId: teamId, slug: slug, id: id) }
        catch { rejectError = error.localizedDescription }
    }

    func stop() {
        allScores.stop()
        allTestRuns.stop()
        allVerifications.stop()
        visionChanges.stop()
    }
}
