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

/// Filters on the EFFECTIVE status — the same loop-derived value the row badge shows
/// (never the stored project status alone, which is stale whenever a project has loops).
/// Falls back to the stored status only while a project's loops haven't reported yet
/// (loopsByRow missing/empty → effectiveProjectStatus returns projectStatus). Mirrors
/// web's visibleProjects.
func visibleRows(_ rows: [ProjectRow], loopsByRow: [String: [StatusLoop]],
                 filter: ProjectFilter, now: Date = Date()) -> [ProjectRow] {
    filter == .all ? rows : rows.filter {
        effectiveProjectStatus(loopsByRow[$0.id] ?? [], projectStatus: $0.project.status, now: now) == "running"
    }
}

@MainActor
final class DashboardStore: ObservableObject {
    @Published var rows: [ProjectRow] = []
    @Published private(set) var teams: [TeamRef] = []
    /// Per-row loops (rowId → StatusLoops) so the filter can use the effective status.
    @Published private(set) var loopsByRow: [String: [StatusLoop]] = [:]
    @Published var loading = true
    @Published var error: String?

    private let db = Firestore.firestore()
    private let teamsListener = QueryListener<[TeamRef]>()
    private var projectListeners: [String: ListenerRegistration] = [:]
    private var loopsListeners: [String: ListenerRegistration] = [:]
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
        reconcileLoopsListeners()
    }

    /// One loops listener per row (same query the row badge uses), so filtering by
    /// effective status works even for rows the filter currently hides.
    private func reconcileLoopsListeners() {
        let ids = Set(rows.map(\.id))
        for (id, reg) in loopsListeners where !ids.contains(id) {
            reg.remove(); loopsListeners[id] = nil; loopsByRow[id] = nil
        }
        for row in rows where loopsListeners[row.id] == nil {
            let rowId = row.id
            loopsListeners[rowId] = loopsQuery(teamId: row.teamId, slug: row.project.slug)
                .addSnapshotListener { [weak self] snap, err in
                    Task { @MainActor in
                        guard let self, err == nil else { return }
                        self.loopsByRow[rowId] = (snap?.documents ?? []).map {
                            Loop(id: $0.documentID, data: $0.data()).asStatusLoop
                        }
                    }
                }
        }
    }

    func stop() {
        teamsListener.stop()
        projectListeners.values.forEach { $0.remove() }
        projectListeners.removeAll(); byTeam.removeAll()
        loopsListeners.values.forEach { $0.remove() }
        loopsListeners.removeAll(); loopsByRow.removeAll()
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
