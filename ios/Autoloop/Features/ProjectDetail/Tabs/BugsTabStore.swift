import Foundation
import FirebaseFirestore

/// All-scope bugs for the Bugs tab.
///
/// Bugs live per-scope (project-direct "__main__" + each loop id), so we use
/// `AllScopeStore` and fan out one listener per scope. Re-subscribe when the
/// set of loop ids changes (mirrors VisionTabStore).
@MainActor
final class BugsTabStore: ObservableObject {
    let allBugs = AllScopeStore<Bug>()

    func subscribe(teamId: String, slug: String, loopIds: [String]) {
        allBugs.update(
            loopIds: loopIds,
            queryBuilder: { loopId in
                bugsQuery(teamId: teamId, slug: slug, loopId: loopId)
            },
            mapper: { doc, _ in
                Bug(id: doc.documentID, data: doc.data())
            }
        )
    }

    func stop() {
        allBugs.stop()
    }
}
