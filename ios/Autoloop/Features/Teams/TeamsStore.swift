import Foundation
import Combine
import FirebaseAuth
import FirebaseFirestore

/// "My teams" via the collectionGroup("members") where uid == me listener — the same
/// pattern DashboardStore uses, factored out so the Teams screen can reuse it. Builds
/// `[TeamRef]` (carrying the viewer's role on each team).
@MainActor
final class MyTeamsListener: ObservableObject {
    @Published private(set) var data: [TeamRef] = []
    @Published private(set) var loading = true
    @Published var error: String?

    private let listener = QueryListener<[TeamRef]>()

    func start() {
        guard let uid = Auth.auth().currentUser?.uid else { loading = false; return }
        let q = Firestore.firestore().collectionGroup("members").whereField("uid", isEqualTo: uid)
        listener.start(q, map: { docs in
            docs.compactMap { d -> TeamRef? in
                guard let teamId = d.reference.parent.parent?.documentID else { return nil }
                return TeamRef(teamId: teamId, data: d.data())
            }
        }, onChange: { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                switch result {
                case .failure(let e): self.error = e.localizedDescription; self.loading = false
                case .success(let teams):
                    self.data = teams.sorted { $0.teamId < $1.teamId }; self.loading = false
                }
            }
        })
    }

    func stop() { listener.stop() }
}

/// Owns the two top-level Teams-screen listeners: "my teams" and "my pending invites".
/// Forwards child changes so a view observing `self` re-renders (mirrors ProjectDetailStore).
@MainActor
final class TeamsStore: ObservableObject {
    let teams = MyTeamsListener()
    let pending = MyPendingInvitesStore()

    private var bag: Set<AnyCancellable> = []

    init() {
        for child in [teams.objectWillChange, pending.objectWillChange] {
            child.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
        }
    }

    var myTeams: [TeamRef] { teams.data }

    func start() { teams.start(); pending.start() }
    func stop() { teams.stop(); pending.stop() }
}
