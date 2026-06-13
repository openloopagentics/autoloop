import SwiftUI

/// Mirrors VisionChangesFeed.tsx / VisionChangeCard.tsx: a collapsible feed of vision changes
/// made by loops (newest first — the listener orders by ULID id desc), each rejectable while
/// still applied (reverts the target to its prior state).
struct VisionChangesFeed: View {
    let changes: [VisionChange]
    let onReject: (String) -> Void

    @State private var expanded = false
    @State private var pendingReject: VisionChange?

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(changes, id: \.id) { change in
                    VisionChangeCard(change: change) { pendingReject = change }
                }
            }
            .padding(.top, 4)
        } label: {
            Text("Changes (\(changes.count))").font(.headline)
        }
        .confirmationDialog(
            pendingReject.map { "Reject this change to “\($0.payloadTitle ?? $0.targetId ?? "")”? It reverts to the prior state." } ?? "",
            isPresented: Binding(get: { pendingReject != nil }, set: { if !$0 { pendingReject = nil } }),
            titleVisibility: .visible
        ) {
            Button("Reject", role: .destructive) {
                if let c = pendingReject { onReject(c.id) }
                pendingReject = nil
            }
            Button("Cancel", role: .cancel) { pendingReject = nil }
        }
    }
}

private struct VisionChangeCard: View {
    let change: VisionChange
    let onRejectTap: () -> Void

    private var opLabel: String {
        switch change.op {
        case "upsert-goal": return "goal"
        case "upsert-scenario": return "scenario"
        default: return change.op ?? "change"
        }
    }
    private var rejected: Bool { change.status == "rejected" }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(opLabel).font(.caption2).padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Color.secondary.opacity(0.15)).clipShape(Capsule())
                Text(change.payloadTitle ?? change.targetId ?? "—").font(.subheadline.bold())
                Spacer()
                Text(rejected ? "Rejected" : "Applied")
                    .font(.caption2).padding(.horizontal, 6).padding(.vertical, 2)
                    .background((rejected ? Color.gray : Color.green).opacity(0.15))
                    .foregroundStyle(rejected ? Color.gray : Color.green)
                    .clipShape(Capsule())
            }
            if let reason = change.reason, !reason.isEmpty {
                Text(reason).font(.caption).foregroundStyle(.secondary)
            }
            HStack(spacing: 12) {
                let created = relativeTime(change.createdAt)
                if !created.isEmpty { Text(created).font(.caption2).foregroundStyle(.secondary) }
                if let loop = change.originLoopId {
                    Text("by \(loop)").font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
                if !rejected {
                    Button("Reject", role: .destructive, action: onRejectTap)
                        .font(.caption).buttonStyle(.bordered)
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}
