import Foundation
import Combine
import FirebaseFirestore

/// Per-team live data for a TeamCardView: members + sent invites + the team doc (name).
/// Mirrors the web TeamAdminContainer's useTeamMembers/useTeamInvites/useTeam hooks.
@MainActor
final class TeamCardStore: ObservableObject {
    let teamId: String

    let members = CollectionStore<Member>()
    let invites = CollectionStore<Invite>()
    @Published private(set) var team: Team?

    private let db = Firestore.firestore()
    private var teamReg: ListenerRegistration?
    private var bag: Set<AnyCancellable> = []

    init(teamId: String) {
        self.teamId = teamId
        for child in [members.objectWillChange, invites.objectWillChange] {
            child.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
        }
    }

    func start() {
        members.start(query: teamMembersQuery(teamId: teamId), map: mapMember)
        invites.start(query: teamInvitesQuery(teamId: teamId), map: mapInvite(teamId: teamId))
        teamReg?.remove()
        teamReg = db.collection("teams").document(teamId)
            .addSnapshotListener { [weak self] snap, _ in
                Task { @MainActor in
                    guard let self else { return }
                    if let snap, snap.exists, let data = snap.data() {
                        self.team = Team(data: data)
                    } else {
                        self.team = nil
                    }
                }
            }
    }

    func stop() {
        members.stop(); invites.stop()
        teamReg?.remove(); teamReg = nil
    }
}
