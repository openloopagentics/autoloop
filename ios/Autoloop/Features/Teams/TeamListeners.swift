import Foundation
import FirebaseAuth
import FirebaseFirestore

// MARK: - Team query builders (ports web/src/teams/hooks.ts)

func teamMembersQuery(teamId: String) -> Query {
    Firestore.firestore().collection("teams").document(teamId).collection("members")
}

func teamInvitesQuery(teamId: String) -> Query {
    Firestore.firestore().collection("teams").document(teamId).collection("invites")
}

/// collectionGroup("invites") where email == current user's (lowercased) email.
/// Returns nil when there is no signed-in user / email (mirrors the hook's early return).
func myPendingInvitesQuery() -> Query? {
    guard let email = Auth.auth().currentUser?.email?.lowercased() else { return nil }
    return Firestore.firestore().collectionGroup("invites").whereField("email", isEqualTo: email)
}

// MARK: - Mapping helpers (reuse with CollectionStore)

func mapMember(_ doc: QueryDocumentSnapshot) -> Member {
    Member(id: doc.documentID, data: doc.data())
}

func mapInvite(teamId: String) -> (QueryDocumentSnapshot) -> Invite {
    { doc in Invite(id: doc.documentID, teamId: teamId, data: doc.data()) }
}

func mapPendingInvite(_ doc: QueryDocumentSnapshot) -> Invite {
    Invite(id: doc.documentID, teamId: doc.reference.parent.parent?.documentID, data: doc.data())
}

// MARK: - My pending invites store

/// Wraps the collectionGroup("invites") listener for the current user.
@MainActor
final class MyPendingInvitesStore: ObservableObject {
    @Published var data: [Invite] = []
    @Published var loading = true
    @Published var error: String?

    private let listener = QueryListener<[Invite]>()

    func start() {
        guard let q = myPendingInvitesQuery() else { loading = false; return }
        listener.start(q, map: { docs in docs.map(mapPendingInvite) },
                       onChange: { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                switch result {
                case .failure(let e): self.error = e.localizedDescription; self.loading = false
                case .success(let items): self.data = items; self.loading = false
                }
            }
        })
    }

    func stop() { listener.stop() }
}
