import SwiftUI
import UIKit

/// One team's card: header (name + copyable id + viewer role badge), member rows,
/// and (managers only) an invite form + sent-invites list. Mirrors web
/// TeamAdminContainer in TeamsPage.tsx, including its card-local action error.
struct TeamCardView: View {
    let teamRef: TeamRef
    @EnvironmentObject var auth: AuthStore
    @Environment(\.palette) private var palette
    @StateObject private var store: TeamCardStore
    @State private var error: String?
    @State private var copied = false

    init(teamRef: TeamRef) {
        self.teamRef = teamRef
        _store = StateObject(wrappedValue: TeamCardStore(teamId: teamRef.teamId))
    }

    private var viewerRole: Role { Role(rawValue: teamRef.role) ?? .member }
    private var isManager: Bool { viewerRole == .owner || viewerRole == .admin }
    private var displayName: String { store.team?.name ?? teamRef.teamId }

    /// Runs an async-throws action and surfaces any error (mirrors useActionError).
    private func run(_ action: @escaping () async throws -> Void) {
        Task {
            do { try await action() }
            catch let e { error = e.localizedDescription }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            if let error { ErrorNote(message: error) }
            membersSection
            if isManager { managerSection }
        }
        .padding(DS.cardPad)
        .cardSurface()
        .onAppear { store.start() }
        .onDisappear { store.stop() }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(displayName).font(.serif(16)).foregroundStyle(palette.fg)
                Button {
                    UIPasteboard.general.string = teamRef.teamId
                    copied = true
                    Task { try? await Task.sleep(nanoseconds: 1_200_000_000); copied = false }
                } label: {
                    HStack(spacing: 5) {
                        Text("ID").font(.caption2).foregroundStyle(.secondary)
                        Text(teamRef.teamId).font(.caption.monospaced())
                        Text(copied ? "copied ✓" : "copy").font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.borderless)
            }
            Spacer()
            Text(viewerRole.rawValue)
                .font(.system(size: 11, weight: .semibold)).textCase(.uppercase).tracking(0.5)
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(palette.accentSoft)
                .foregroundStyle(viewerRole == .owner ? palette.accent : palette.fgSoft)
                .clipShape(Capsule())
        }
    }

    @ViewBuilder
    private var membersSection: some View {
        if store.members.loading {
            Spinner(label: "Loading members…")
        } else if let e = store.members.error {
            ErrorNote(message: e)
        } else {
            VStack(spacing: 0) {
                ForEach(store.members.data) { m in
                    MemberRowView(
                        member: m, viewerRole: viewerRole, selfUid: auth.user?.uid,
                        onChangeRole: { uid, role in
                            run { try await TeamActions.changeRole(teamId: teamRef.teamId, uid: uid, role: role) }
                        },
                        onRemove: { uid in
                            run { try await TeamActions.removeMember(teamId: teamRef.teamId, uid: uid) }
                        })
                    Divider()
                }
            }
        }
    }

    private var managerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            InviteFormView { email, role in
                run { try await TeamActions.inviteMember(teamId: teamRef.teamId, email: email, role: role) }
            }
            if store.invites.loading {
                Spinner(label: "Loading invites…")
            } else if let e = store.invites.error {
                ErrorNote(message: e)
            } else if !store.invites.data.isEmpty {
                VStack(spacing: 0) {
                    ForEach(store.invites.data) { inv in
                        InviteRowView(invite: inv) { i in
                            run { try await TeamActions.revokeInvite(teamId: teamRef.teamId, inviteId: i.id) }
                        }
                    }
                }
            }
        }
    }
}
