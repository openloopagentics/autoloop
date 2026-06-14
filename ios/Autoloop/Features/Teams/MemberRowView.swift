import SwiftUI

/// Mirrors web MemberRow.tsx. Rank-aware management gating + an always-present
/// "Leave" button for the viewer's own row.
struct MemberRowView: View {
    let member: Member
    let viewerRole: Role
    let selfUid: String?
    let onChangeRole: (String, Role) -> Void
    let onRemove: (String) -> Void

    private var isSelf: Bool { member.uid == selfUid }

    /// owner manages anyone (non-self); admin manages only `member` rows.
    private var canManage: Bool {
        !isSelf && (viewerRole == .owner || (viewerRole == .admin && member.role == .member))
    }

    private var roleOptions: [Role] { viewerRole == .owner ? [.owner, .admin, .member] : [.member] }

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(member.email ?? member.uid).font(.subheadline)
                    if isSelf {
                        Text("you").font(.caption2).foregroundStyle(.secondary)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(.secondary.opacity(0.15), in: Capsule())
                    }
                }
                if member.email != nil {
                    Text(member.uid).font(.caption2.monospaced()).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if canManage {
                Menu {
                    ForEach(roleOptions, id: \.self) { r in
                        Button {
                            if r != member.role { onChangeRole(member.uid, r) }
                        } label: {
                            if r == member.role { Label(r.rawValue, systemImage: "checkmark") }
                            else { Text(r.rawValue) }
                        }
                    }
                } label: {
                    Text(member.role.rawValue).font(.caption)
                }
                Button("Remove", role: .destructive) { onRemove(member.uid) }
                    .font(.caption).buttonStyle(.borderless)
            } else {
                Text(member.role.rawValue)
                    .font(.caption)
                    .foregroundStyle(member.role == .owner ? .primary : .secondary)
            }
            if isSelf {
                Button("Leave") { onRemove(member.uid) }
                    .font(.caption).buttonStyle(.borderless)
            }
        }
        .padding(.vertical, 4)
    }
}
