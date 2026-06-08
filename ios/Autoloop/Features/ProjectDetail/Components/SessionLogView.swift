import SwiftUI

/// Mirrors SessionLogTab.tsx: renders grouped sessions (one block per scope),
/// each with start–end time and entries (you / claude / tool with ✓/✗).
struct SessionLogView: View {
    /// Grouped + ordered by the store (newest loop first; project-direct last).
    let sessionsByScope: [(scopeLabel: String, sessions: [SessionDoc])]

    var body: some View {
        if sessionsByScope.isEmpty {
            EmptyState(text: "No session log yet — it appears once a loop runs.")
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(sessionsByScope, id: \.scopeLabel) { group in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(group.scopeLabel)
                                .font(.headline)
                                .foregroundStyle(.secondary)
                            ForEach(Array(group.sessions.enumerated()), id: \.element.id) { idx, session in
                                SessionBlock(session: session,
                                             index: idx,
                                             single: group.sessions.count == 1)
                            }
                        }
                        .padding(.horizontal)
                    }
                }
                .padding(.vertical)
            }
        }
    }
}

/// One session: header (when multiple), entries, and "show all" beyond first 50.
private struct SessionBlock: View {
    let session: SessionDoc
    let index: Int
    let single: Bool
    @State private var showAll = false

    private var visible: [SessionEntry] {
        showAll ? session.entries : Array(session.entries.prefix(50))
    }
    private var hidden: Int { session.entries.count - 50 }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !single {
                let start = formatSessionTime(session.startedAt)
                let end = formatSessionTime(session.endedAt)
                Text("Session \(index + 1) · \(start)\(!end.isEmpty && end != start ? " – \(end)" : "")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach(Array(visible.enumerated()), id: \.offset) { _, entry in
                EntryRow(entry: entry)
            }
            if !showAll && hidden > 0 {
                Button("\(hidden) more entries — show all") { showAll = true }
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct EntryRow: View {
    let entry: SessionEntry

    var body: some View {
        switch entry {
        case .user(let text, _):
            HStack(alignment: .top, spacing: 6) {
                Text("you").font(.caption).foregroundStyle(.secondary)
                Text(text).font(.subheadline)
            }
        case .assistant(let text, _):
            HStack(alignment: .top, spacing: 6) {
                Text("claude").font(.caption).bold()
                Text(text).font(.subheadline)
            }
        case .tool(let name, let summary, let ok, _):
            HStack(alignment: .top, spacing: 6) {
                Text(ok ? "✓" : "✗").foregroundStyle(ok ? .green : .red)
                Text(name).font(.caption.bold())
                Text(summary).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

/// Mirrors SessionLogTab.tsx formatTime: ts is epoch MILLIS; format HH:mm.
func formatSessionTime(_ ts: Double) -> String {
    guard ts != 0 else { return "" }
    let date = Date(timeIntervalSince1970: ts / 1000)
    let f = DateFormatter()
    f.dateFormat = "HH:mm"
    return f.string(from: date)
}
