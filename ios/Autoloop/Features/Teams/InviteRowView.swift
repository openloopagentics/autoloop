import SwiftUI

/// A sent (pending) invite on a team — mirrors web InviteRow.tsx. Manager-only.
struct InviteRowView: View {
    let invite: Invite
    let onRevoke: (Invite) -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "envelope").font(.caption).foregroundStyle(.secondary)
            Text(invite.email).font(.caption)
            Text(invite.role.rawValue).font(.caption).foregroundStyle(.secondary)
            Spacer()
            Text("invite sent").font(.caption2).foregroundStyle(.secondary)
            Button("Revoke") { onRevoke(invite) }
                .font(.caption).buttonStyle(.borderless)
        }
        .padding(.vertical, 4)
    }
}

/// A pending invite addressed to the viewer — mirrors web PendingInviteRow.tsx.
struct PendingInviteRowView: View {
    let invite: Invite
    let onAccept: (Invite) -> Void
    let onDecline: (Invite) -> Void

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Team invitation").font(.subheadline)
                HStack(spacing: 4) {
                    Text("as").font(.caption).foregroundStyle(.secondary)
                    Text(invite.role.rawValue).font(.caption)
                }
            }
            Spacer()
            Button("Accept") { onAccept(invite) }.buttonStyle(.borderedProminent).controlSize(.small)
            Button("Decline") { onDecline(invite) }.buttonStyle(.bordered).controlSize(.small)
        }
        .padding(.vertical, 4)
    }
}
