import SwiftUI

/// Teams screen — mirrors web TeamsPage.tsx: create a team, your pending invites,
/// and a card per team you belong to (member + invite management).
struct TeamsView: View {
    @StateObject private var store = TeamsStore()
    @State private var newTeamName = ""
    @State private var error: String?

    /// Runs an async-throws action and surfaces any error (mirrors useActionError).
    private func run(_ action: @escaping () async throws -> Void) {
        Task {
            do { try await action() }
            catch let e { error = e.localizedDescription }
        }
    }

    var body: some View {
        List {
            if let error { Section { ErrorNote(message: error) } }

            Section("Create a team") {
                HStack(spacing: 8) {
                    TextField("Team name", text: $newTeamName)
                        .textFieldStyle(.roundedBorder)
                    Button("Create team") {
                        let name = newTeamName.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !name.isEmpty else { return }
                        run { try await TeamActions.createTeam(teamId: teamIdFromName(name), name: name) }
                        newTeamName = ""
                    }
                    .buttonStyle(.bordered).controlSize(.small)
                    .disabled(newTeamName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }

            Section("Pending invites for you") {
                if store.pending.loading {
                    Spinner(label: "Loading invites…")
                } else if let e = store.pending.error {
                    ErrorNote(message: e)
                } else if store.pending.data.isEmpty {
                    Text("No pending invites").foregroundStyle(.secondary)
                } else {
                    ForEach(store.pending.data) { inv in
                        PendingInviteRowView(
                            invite: inv,
                            onAccept: { i in run { try await TeamActions.acceptInvite(i) } },
                            onDecline: { i in run { try await TeamActions.declineInvite(i) } })
                    }
                }
            }

            Section("Your teams") {
                if store.teams.loading {
                    Spinner(label: "Loading teams…")
                } else if let e = store.teams.error {
                    ErrorNote(message: e)
                } else if store.myTeams.isEmpty {
                    Text("You're not on a team yet.").foregroundStyle(.secondary)
                } else {
                    ForEach(store.myTeams) { t in
                        TeamCardView(teamRef: t)
                            .listRowInsets(EdgeInsets(top: 6, leading: 8, bottom: 6, trailing: 8))
                    }
                }
            }
        }
        .navigationTitle("Teams")
        .onAppear { store.start() }
        .onDisappear { store.stop() }
    }
}
