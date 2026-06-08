import SwiftUI

/// Mirrors BugItem.tsx: title, severity chip, status, description, scenario/task refs.
struct BugRow: View {
    let bug: Bug

    private var status: String { bug.status ?? "open" }

    private var severityColor: Color {
        switch bug.severity {
        case "high":   return .red
        case "medium": return .orange
        case "low":    return .gray
        default:       return .gray
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(bug.title ?? bug.id)
                    .font(.headline)
                Spacer()
                if let severity = bug.severity {
                    Text(severity)
                        .font(.caption)
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .background(severityColor.opacity(0.18))
                        .foregroundStyle(severityColor)
                        .clipShape(Capsule())
                }
                StatusBadge(status: status)
            }
            if let desc = bug.description {
                Text(desc)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if bug.scenarioId != nil || bug.taskId != nil {
                HStack(spacing: 12) {
                    if let scenarioId = bug.scenarioId {
                        Text("scenario \(scenarioId)")
                    }
                    if let taskId = bug.taskId {
                        Text("task \(taskId)")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
