import Foundation
import Combine
import FirebaseFirestore

/// Ideas backlog for the Ideas tab. Ideas are project-direct (they outlive the loop that
/// proposed them) — a single project-level `CollectionStore`, sorted in memory by band.
@MainActor
final class IdeasTabStore: ObservableObject {
    let ideas = CollectionStore<Idea>()
    @Published var actionError: String?

    private var teamId = ""
    private var slug = ""
    private var bag: Set<AnyCancellable> = []

    // Forward the nested CollectionStore's changes — otherwise the view (which observes only
    // this store) never re-renders when the listener loads, and the spinner never clears.
    init() {
        ideas.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
    }

    func subscribe(teamId: String, slug: String) {
        self.teamId = teamId
        self.slug = slug
        ideas.start(query: ideasQuery(teamId: teamId, slug: slug)) {
            Idea(id: $0.documentID, data: $0.data())
        }
    }

    func stop() { ideas.stop() }

    /// Band-sorted view of the live ideas.
    var sorted: [Idea] {
        let recs = sortIdeas(ideas.data.map(\.asRec))
        let byId = Dictionary(uniqueKeysWithValues: ideas.data.map { ($0.id, $0) })
        return recs.compactMap { byId[$0.id] }
    }

    func setStatus(_ id: String, _ status: String) async {
        await put(id, IdeaBody(status: status))
    }

    func add(title: String, rationale: String?) async {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let id = ideaIdFor(trimmed, taken: Set(ideas.data.map(\.id)))
        let r = rationale?.trimmingCharacters(in: .whitespacesAndNewlines)
        await put(id, IdeaBody(title: trimmed, rationale: (r?.isEmpty == false) ? r : nil,
                               status: "proposed", order: 100))
    }

    /// Apply the order writes a reorder produces (mirrors IdeasTab.handleMove).
    func move(_ id: String, _ dir: MoveDir) async {
        let writes = moveIdea(ideas.data.map(\.asRec), id: id, dir: dir)
        guard !writes.isEmpty else { return }
        for w in writes { await put(w.id, IdeaBody(order: w.order)) }
    }

    private func put(_ id: String, _ body: IdeaBody) async {
        actionError = nil
        do { try await RestClient.putIdea(teamId: teamId, slug: slug, id: id, body: body) }
        catch { actionError = error.localizedDescription }
    }
}
