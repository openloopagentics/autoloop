import SwiftUI

/// Mirrors RevisionTimeline.tsx: revisions with their trigger scenario/reason
/// and the change ops (op + taskId) each revision applied.
struct RevisionTimeline: View {
    let revisions: [Revision]

    var body: some View {
        if revisions.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 12) {
                Text("Revisions")
                    .font(.title3.bold())
                    .padding(.horizontal)
                ForEach(revisions, id: \.id) { rev in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) {
                            if let scn = rev.triggerScenarioId {
                                Text(scn)
                                    .font(.caption.monospaced())
                                    .foregroundStyle(.secondary)
                            }
                            if let reason = rev.triggerReason {
                                Text(reason)
                                    .font(.subheadline)
                            }
                            Spacer()
                        }
                        if let changes = rev.changes, !changes.isEmpty {
                            VStack(alignment: .leading, spacing: 2) {
                                ForEach(Array(changes.enumerated()), id: \.offset) { _, c in
                                    HStack(spacing: 6) {
                                        Text(c.op)
                                            .font(.caption.monospaced())
                                            .foregroundStyle(.secondary)
                                        Text(c.taskId)
                                            .font(.caption.monospaced())
                                    }
                                }
                            }
                        }
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .cardSurface()
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .padding(.horizontal)
                }
            }
        }
    }
}
