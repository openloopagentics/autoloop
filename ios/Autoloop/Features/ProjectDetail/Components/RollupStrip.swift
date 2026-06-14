import SwiftUI

/// Mirrors RollupStrip.tsx: shows total loop count, running loop count,
/// and the project's effective status badge (when present).
struct RollupStrip: View {
    @Environment(\.palette) private var palette
    let loops: [SelectableLoop]
    let status: String?

    private var runningCount: Int {
        loops.filter { loopIsRunning(status: $0.status) }.count
    }

    var body: some View {
        HStack(spacing: 28) {
            metric("\(loops.count)", "loops")
            metric("\(runningCount)", "running")
            if let status { StatusBadge(status: status) }
            Spacer()
        }
        .padding(DS.cardPad)
        .cardSurface()
        .padding(.horizontal)
    }

    private func metric(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.serif(24, .bold)).monospacedDigit()
                .foregroundStyle(palette.fg)
            Text(label)
                .font(.system(size: 11)).textCase(.uppercase).tracking(0.6)
                .foregroundStyle(palette.fgMeta)
        }
    }
}
