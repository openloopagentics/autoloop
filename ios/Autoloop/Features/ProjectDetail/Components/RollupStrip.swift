import SwiftUI

/// Mirrors RollupStrip.tsx: shows total loop count, running loop count,
/// and the project's effective status badge (when present).
struct RollupStrip: View {
    let loops: [SelectableLoop]
    let status: String?

    private var runningCount: Int {
        loops.filter { loopIsRunning(status: $0.status) }.count
    }

    var body: some View {
        HStack(spacing: 24) {
            VStack(spacing: 2) {
                Text("\(loops.count)")
                    .font(.title2.monospacedDigit().bold())
                Text("loops")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 2) {
                Text("\(runningCount)")
                    .font(.title2.monospacedDigit().bold())
                Text("running")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let status {
                StatusBadge(status: status)
            }

            Spacer()
        }
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal)
    }
}
