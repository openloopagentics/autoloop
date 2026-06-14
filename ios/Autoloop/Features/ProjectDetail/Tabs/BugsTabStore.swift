import Foundation
import Combine
import FirebaseFirestore

/// All-scope bugs for the Bugs tab.
///
/// Bugs live per-scope (project-direct "__main__" + each loop id), so we use
/// `AllScopeStore` and fan out one listener per scope. Re-subscribe when the
/// set of loop ids changes (mirrors VisionTabStore).
@MainActor
final class BugsTabStore: ObservableObject {
    let allBugs = AllScopeStore<Bug>()

    private var bag: Set<AnyCancellable> = []
    // Forward nested-store changes so the view re-renders when listeners load.
    init() {
        allBugs.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
    }

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
