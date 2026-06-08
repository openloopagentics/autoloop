import SwiftUI

/// Mirrors LoopRow.tsx: a tappable loop row showing name/goal, status badge,
/// and (for the selected loop) phase progress + scenarios-met counts.
///
/// Subscription strategy (b): only the SELECTED loop has live phases/scores/
/// testRuns listeners (owned by LoopsTabStore), so only the selected row shows
/// progress/met numbers. Non-selected rows stay light to cap concurrent
/// listeners on mobile.
struct LoopRow: View {
    let loop: SelectableLoop
    let selected: Bool
    /// Progress + met counts; nil for non-selected (light) rows.
    let progress: (done: Int, total: Int)?
    let met: (met: Int, total: Int)?
    let onSelect: () -> Void

    private var displayName: String {
        loop.isMain ? "main (legacy)" : (loop.name ?? loop.goal ?? loop.id)
    }

    var body: some View {
        Button(action: onSelect) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(displayName)
                        .font(.headline)
                        .foregroundStyle(.primary)
                    if let status = loop.status {
                        StatusBadge(status: status)
                    }
                    Spacer()
                    Image(systemName: selected ? "chevron.down" : "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let p = progress, let m = met {
                    HStack(spacing: 16) {
                        Text("\(p.done)/\(p.total) phases")
                            .monospacedDigit()
                        Text("\(m.met)/\(m.total) met")
                            .monospacedDigit()
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.regularMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(selected ? Color.accentColor : Color.clear, lineWidth: 2)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }
}
