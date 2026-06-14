import SwiftUI

/// Mirrors LoopSnapshot.tsx: shows the selected loop's name/goal,
/// phase progress, scenario-met count, and the current active task.
struct LoopSnapshot: View {
    let loop: SelectableLoop
    let phases: [Phase]
    let tasks: [ProjectTask]
    let scenarios: [Scenario]
    let scores: [Score]
    let testRuns: [TestRun]

    private var phaseStats: (done: Int, total: Int) {
        phaseProgress(phases.map(\.asPhaseRec))
    }

    private var scenarioStats: (met: Int, total: Int) {
        summarize(scenarios.map(\.asRec),
                  scores: scores.map(\.asRec),
                  testRuns: testRuns.map(\.asRec))
    }

    private var currentTask: ProjectTask? {
        guard let taskId = loop.currentTaskId else { return nil }
        return tasks.first { $0.id == taskId }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header: loop name + status badge
            HStack {
                Text(loop.name ?? loop.goal ?? loop.id)
                    .font(.headline)
                if let status = loop.status {
                    StatusBadge(status: status)
                }
                Spacer()
            }

            // Metrics row
            HStack(spacing: 20) {
                Label {
                    Text("\(phaseStats.done)/\(phaseStats.total)")
                        .monospacedDigit()
                        + Text(" phases").foregroundColor(.secondary)
                } icon: {
                    Image(systemName: "checklist")
                        .foregroundStyle(.secondary)
                }

                Label {
                    Text("\(scenarioStats.met)/\(scenarioStats.total)")
                        .monospacedDigit()
                        + Text(" scenarios met").foregroundColor(.secondary)
                } icon: {
                    Image(systemName: "checkmark.seal")
                        .foregroundStyle(.secondary)
                }
            }
            .font(.subheadline)

            // Current task
            Group {
                if let task = currentTask {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(Color.green)
                            .frame(width: 8, height: 8)
                        Text("In progress: \(task.title ?? task.id)")
                            .font(.subheadline)
                    }
                } else {
                    Text("No active task")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding()
        .cardSurface()
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal)
    }
}
