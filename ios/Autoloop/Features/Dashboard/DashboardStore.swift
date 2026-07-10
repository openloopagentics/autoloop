import Foundation
import FirebaseAuth
import FirebaseFirestore

struct ProjectRow: Identifiable, Equatable {
    let teamId: String
    let project: Project
    var id: String { "\(teamId)/\(project.slug)" }
}

/// Dashboard quick-glance filter: what's running vs the full list (one tap away).
enum ProjectFilter: String, CaseIterable, Identifiable {
    case running = "Running"
    case all = "All"
    var id: String { rawValue }
}

/// Filters on the STORED project status (the loop keeps it current). The per-row badge
/// still shows the loop-derived effective status, so a zombie loop surfaces under
/// Running with a non-running badge — on purpose: it needs attention. Mirrors web's
/// TeamSection filter.
func visibleRows(_ rows: [ProjectRow], filter: ProjectFilter) -> [ProjectRow] {
    filter == .all ? rows : rows.filter { $0.project.status == "running" }
}

@MainActor
final class DashboardStore: ObservableObject {
    @Published var rows: [ProjectRow] = []
    @Published private(set) var teams: [TeamRef] = []
    @Published var loading = true
    @Published var error: String?

    private let db = Firestore.firestore()
    private let teamsListener = QueryListener<[TeamRef]>()
    private var projectListeners: [String: ListenerRegistration] = [:]
    private var byTeam: [String: [ProjectRow]] = [:]

    func start() {
        guard let uid = Auth.auth().currentUser?.uid else { loading = false; return }
        let q = db.collectionGroup("members").whereField("uid", isEqualTo: uid)
        teamsListener.start(q, map: { docs in
            docs.compactMap { d -> TeamRef? in
                guard let teamId = d.reference.parent.parent?.documentID else { return nil }
                return TeamRef(teamId: teamId, data: d.data())
            }
        }, onChange: { [weak self] result in
            Task { @MainActor in self?.handleTeams(result) }
        })
    }

    private func handleTeams(_ result: Result<[TeamRef], Error>) {
        switch result {
        case .failure(let e): error = e.localizedDescription; loading = false
        case .success(let teams):
            self.teams = teams.sorted { $0.teamId < $1.teamId }
            let ids = Set(teams.map(\.teamId))
            for (id, reg) in projectListeners where !ids.contains(id) {
                reg.remove(); projectListeners[id] = nil; byTeam[id] = nil
            }
            for t in teams where projectListeners[t.teamId] == nil {
                listenProjects(teamId: t.teamId)
            }
            rebuild(); loading = false
        }
    }

    private func listenProjects(teamId: String) {
        projectListeners[teamId] = db.collection("teams").document(teamId).collection("projects")
            .addSnapshotListener { [weak self] snap, err in
                Task { @MainActor in
                    guard let self else { return }
                    if let err { self.error = err.localizedDescription; return }
                    self.byTeam[teamId] = (snap?.documents ?? []).map {
                        ProjectRow(teamId: teamId, project: Project(slug: $0.documentID, data: $0.data()))
                    }
                    self.rebuild()
                }
            }
    }

    private func rebuild() {
        rows = byTeam.values.flatMap { $0 }.sorted { $0.id < $1.id }
    }

    func stop() {
        teamsListener.stop()
        projectListeners.values.forEach { $0.remove() }
        projectListeners.removeAll(); byTeam.removeAll()
    }

    /// The user's role on a team, if they're a member.
    func role(forTeam teamId: String) -> String? {
        teams.first { $0.teamId == teamId }?.role
    }

    /// Mirrors DashboardHome.tsx: owners and admins may delete projects.
    /// ("manager" is not a real role — the vocabulary is owner|admin|member.)
    func canDelete(teamId: String) -> Bool {
        let r = role(forTeam: teamId)
        return r == "owner" || r == "admin"
    }
}
