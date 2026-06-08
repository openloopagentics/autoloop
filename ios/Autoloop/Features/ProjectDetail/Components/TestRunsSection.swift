import SwiftUI

/// Mirrors TestRunsSection.tsx: test runs for the selected loop, latest first
/// (highest id), with passed/failed counts, scenario id, and summary.
struct TestRunsSection: View {
    let testRuns: [TestRun]

    private var sorted: [TestRun] {
        testRuns.sorted { $0.id > $1.id }  // latest (highest id) first
    }

    var body: some View {
        if testRuns.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 12) {
                Text("Test runs")
                    .font(.title3.bold())
                    .padding(.horizontal)
                ForEach(sorted, id: \.id) { run in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("\(run.passed ?? 0) passed · \(run.failed ?? 0) failed")
                                .font(.subheadline.monospacedDigit())
                            if let scn = run.scenarioId {
                                Text(scn)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                        if let summary = run.summary, !summary.isEmpty {
                            Text(summary)
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.regularMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .padding(.horizontal)
                }
            }
        }
    }
}
