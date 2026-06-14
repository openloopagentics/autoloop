import SwiftUI

/// Teams screen — mirrors web TeamsPage.tsx. The team list fills the screen; "create a team"
/// (+) and "pending invites" (bell, badged when any are waiting) live in the top toolbar.
struct TeamsView: View {
    @Environment(\.palette) private var palette
    @StateObject private var store = TeamsStore()
    @State private var error: String?
    @State private var showCreate = false
    @State private var newTeamName = ""
    @State private var showPending = false

    /// Runs an async-throws action and surfaces any error (mirrors useActionError).
    private func run(_ action: @escaping () async throws -> Void) {
        Task {
            do { try await action() }
            catch let e { error = e.localizedDescription }
        }
    }

    private var pendingCount: Int { store.pending.data.count }

    var body: some View {
        teamList
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .appBackground(palette)
            .navigationTitle("Teams")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { showPending = true } label: {
                        Image(systemName: pendingCount > 0 ? "bell.badge.fill" : "bell")
                    }
                    .accessibilityLabel("Pending invites")
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { newTeamName = ""; showCreate = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Create team")
                }
            }
            .alert("Create a team", isPresented: $showCreate) {
                TextField("Team name", text: $newTeamName)
                Button("Create") {
                    let name = newTeamName.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !name.isEmpty else { return }
                    run { try await TeamActions.createTeam(teamId: teamIdFromName(name), name: name) }
                }
                Button("Cancel", role: .cancel) {}
            } message: { Text("Pick a name for your new team.") }
            .sheet(isPresented: $showPending) { pendingSheet }
            .onAppear { store.start() }
            .onDisappear { store.stop() }
    }

    @ViewBuilder private var teamList: some View {
        if store.teams.loading {
            Spinner(label: "Loading teams…")
        } else if let e = store.teams.error {
            ErrorNote(message: e).padding()
        } else if store.myTeams.isEmpty {
            EmptyState(text: "You're not on a team yet. Tap + to create one.")
        } else {
            List {
                if let error { ErrorNote(message: error).listRowBackground(Color.clear).listRowSeparator(.hidden) }
                ForEach(store.myTeams) { t in
                    TeamCardView(teamRef: t)
                        .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
        }
    }

    private var pendingSheet: some View {
        NavigationStack {
            Group {
                if store.pending.loading {
                    Spinner(label: "Loading invites…")
                } else if let e = store.pending.error {
                    ErrorNote(message: e).padding()
                } else if store.pending.data.isEmpty {
                    EmptyState(text: "No pending invites.")
                } else {
                    List {
                        ForEach(store.pending.data) { inv in
                            PendingInviteRowView(
                                invite: inv,
                                onAccept: { i in run { try await TeamActions.acceptInvite(i) } },
                                onDecline: { i in run { try await TeamActions.declineInvite(i) } })
                                .listRowBackground(palette.surfaceRaised)
                        }
                    }
                    .scrollContentBackground(.hidden)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .appBackground(palette)
            .navigationTitle("Pending invites")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showPending = false } } }
        }
    }
}
