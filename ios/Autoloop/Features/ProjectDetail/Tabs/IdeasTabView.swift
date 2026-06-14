import SwiftUI

/// Mirrors IdeasTab.tsx: band-sorted ideas (accepted → proposed → rejected → done) with
/// accept/reject + reorder for actionable ideas, and a composer to add a new idea.
struct IdeasTabView: View {
    @ObservedObject var store: ProjectDetailStore
    @StateObject private var tabStore = IdeasTabStore()

    @State private var title = ""
    @State private var rationale = ""
    @State private var busy = false

    private var sorted: [Idea] { tabStore.sorted }

    /// (idx, len) of an idea within its own status band — drives the reorder-arrow enabling.
    private func bandIndex(_ id: String) -> (idx: Int, len: Int) {
        guard let me = sorted.first(where: { $0.id == id }) else { return (0, 0) }
        let band = sorted.filter { ($0.status ?? "proposed") == (me.status ?? "proposed") }
        return (band.firstIndex { $0.id == id } ?? 0, band.count)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Ideas").font(.title3.bold()).padding(.horizontal)

                if let e = tabStore.actionError { ErrorNote(message: e).padding(.horizontal) }

                if sorted.isEmpty {
                    if tabStore.ideas.loading && tabStore.ideas.data.isEmpty {
                        HStack { Spacer(); Spinner(); Spacer() }.padding()
                    } else {
                        EmptyState(text: "No ideas yet.")
                    }
                } else {
                    ForEach(sorted, id: \.id) { idea in
                        let bi = bandIndex(idea.id)
                        IdeaRow(idea: idea, canMoveUp: bi.idx > 0, canMoveDown: bi.idx < bi.len - 1,
                                busy: busy,
                                onStatus: { status in run { await tabStore.setStatus(idea.id, status) } },
                                onMove: { dir in run { await tabStore.move(idea.id, dir) } })
                            .padding(.horizontal)
                    }
                }

                composer
            }
            .padding(.vertical)
        }
        .onAppear { tabStore.subscribe(teamId: store.teamId, slug: store.slug) }
        .onDisappear { tabStore.stop() }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Idea title…", text: $title)
                .textFieldStyle(.roundedBorder)
            TextField("Rationale (optional)…", text: $rationale, axis: .vertical)
                .lineLimit(2...4)
                .textFieldStyle(.roundedBorder)
            Button {
                run {
                    await tabStore.add(title: title, rationale: rationale)
                    title = ""; rationale = ""
                }
            } label: {
                Text("Add idea").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(busy || title.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding()
        .cardSurface()
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal)
    }

    /// Run an async mutation while reflecting busy state (mirrors IdeasTab's guard()).
    private func run(_ fn: @escaping () async -> Void) {
        busy = true
        Task { await fn(); busy = false }
    }
}

/// Mirrors IdeaItem.tsx: status chip, title, by/refs, accept/reject + reorder, collapsible rationale.
private struct IdeaRow: View {
    let idea: Idea
    let canMoveUp: Bool
    let canMoveDown: Bool
    let busy: Bool
    let onStatus: (String) -> Void
    let onMove: (MoveDir) -> Void

    @State private var showRationale = false

    private var status: String { idea.status ?? "proposed" }
    private var actionable: Bool { status == "proposed" || status == "accepted" }

    private var chipColor: Color {
        switch status {
        case "accepted": return .green
        case "rejected": return .red
        case "done": return .blue
        default: return .orange   // proposed
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(status).font(.caption).padding(.horizontal, 8).padding(.vertical, 2)
                    .background(chipColor.opacity(0.18)).foregroundStyle(chipColor).clipShape(Capsule())
                Text(idea.title ?? idea.id).font(.headline)
                if let by = idea.by {
                    Text(by).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
            }

            if actionable {
                HStack(spacing: 8) {
                    Button("Accept") { onStatus("accepted") }
                        .buttonStyle(.bordered).tint(.green)
                    Button("Reject") { onStatus("rejected") }
                        .buttonStyle(.bordered).tint(.red)
                    Spacer()
                    Button { onMove(.up) } label: { Image(systemName: "arrow.up") }
                        .buttonStyle(.bordered).disabled(!canMoveUp)
                    Button { onMove(.down) } label: { Image(systemName: "arrow.down") }
                        .buttonStyle(.bordered).disabled(!canMoveDown)
                }
                .font(.caption)
                .disabled(busy)
            }

            if let rationale = idea.rationale, !rationale.isEmpty {
                DisclosureGroup(isExpanded: $showRationale) {
                    MarkdownView(text: rationale)
                } label: {
                    Text("rationale").font(.caption).foregroundStyle(.secondary)
                }
            }

            if idea.originLoopId != nil || idea.builtInLoopId != nil {
                HStack(spacing: 12) {
                    if let from = idea.originLoopId { Text("from \(from)") }
                    if let built = idea.builtInLoopId { Text("built in \(built)") }
                }
                .font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface()
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
