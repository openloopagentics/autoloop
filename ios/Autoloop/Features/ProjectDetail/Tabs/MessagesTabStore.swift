import Foundation
import FirebaseFirestore

/// Messages thread + per-scope Session Log for the Messages tab.
///
/// - `messages`: a single project-level `CollectionStore` (messagesQuery).
/// - Session Log: SessionDoc has no loopId, so `AllScopeStore`'s flatten-merge
///   would lose the scope grouping the web renders (one block per loop). Instead
///   we keep a `[scopeKey: [SessionDoc]]` dictionary maintained by one
///   `sessionsQuery` listener per scope (project-direct "__main__" + each loop),
///   and expose grouped, ordered results via `sessionsByScope` (newest loop first,
///   project-direct last). Re-subscribe when the loop set changes.
@MainActor
final class MessagesTabStore: ObservableObject {
    let messages = CollectionStore<Message>()

    /// Grouped session log, ordered (newest loop first; project-direct last).
    @Published private(set) var sessionsByScope: [(scopeLabel: String, sessions: [SessionDoc])] = []
    @Published var sendError: String?

    private var byScope: [String: [SessionDoc]] = [:]
    private var listeners: [String: QueryListener<[SessionDoc]>] = [:]
    private var currentScopes: Set<String> = []
    /// Ordered loop ids as last seen (newest first), used to order output.
    private var orderedLoopIds: [String] = []
    /// Per-loop display label (day · #order) keyed by loop id.
    private var labelByLoop: [String: String] = [:]

    private var teamId = ""
    private var slug = ""

    // MARK: - Lifecycle

    func start(teamId: String, slug: String, loops: [Loop]) {
        self.teamId = teamId
        self.slug = slug
        messages.start(query: messagesQuery(teamId: teamId, slug: slug)) {
            Message(id: $0.documentID, data: $0.data())
        }
        subscribeSessions(loops: loops)
    }

    /// (Re)subscribe session listeners — one per loop. Sessions are loop-scoped only;
    /// the web's useSessionLog returns empty for the project-direct scope and
    /// SessionLogTab iterates loops only, so we do NOT subscribe a project-direct scope.
    func subscribeSessions(loops: [Loop]) {
        // Newest loop first (startedAt desc, then order desc, then id desc) and day-grouped —
        // mirrors SessionLogTab.tsx using groupLoopRuns over the selectable loop list.
        let selectable = buildLoopList(loops.map(\.asLoopRec), project: nil, hasProjectDirectData: false)
        let groups = groupLoopRuns(selectable)
        orderedLoopIds = []
        labelByLoop = [:]
        for g in groups {
            let dayLabel = g.label == "earlier" ? "Earlier" : (g.label == "legacy" ? "Legacy" : g.label)
            for loop in g.loops {
                orderedLoopIds.append(loop.id)
                let iter = loop.order.map { " · #\($0)" } ?? ""
                labelByLoop[loop.id] = "\(dayLabel)\(iter)"
            }
        }

        let newScopes: Set<String> = Set(orderedLoopIds)

        for gone in currentScopes.subtracting(newScopes) {
            listeners[gone]?.stop()
            listeners[gone] = nil
            byScope[gone] = nil
        }

        for scopeKey in newScopes.subtracting(currentScopes) {
            let loopId: String? = scopeKey
            let ql = QueryListener<[SessionDoc]>()
            ql.start(sessionsQuery(teamId: teamId, slug: slug, loopId: loopId), map: { docs in
                docs.map { SessionDoc(id: $0.documentID, data: $0.data()) }
            }, onChange: { [weak self] result in
                Task { @MainActor in
                    guard let self else { return }
                    if case .success(let items) = result {
                        self.byScope[scopeKey] = items
                        self.publish()
                    }
                }
            })
            listeners[scopeKey] = ql
        }

        currentScopes = newScopes
        publish()
    }

    private func publish() {
        var out: [(scopeLabel: String, sessions: [SessionDoc])] = []
        for loopId in orderedLoopIds {
            let sessions = byScope[loopId] ?? []
            if !sessions.isEmpty { out.append((scopeLabel: labelByLoop[loopId] ?? loopId, sessions: sessions)) }
        }
        sessionsByScope = out
    }

    // MARK: - Send

    func send(text: String) async {
        sendError = nil
        do {
            try await RestClient.postMessage(teamId: teamId, slug: slug, text: text)
        } catch {
            sendError = error.localizedDescription
        }
    }

    func stop() {
        messages.stop()
        listeners.values.forEach { $0.stop() }
        listeners.removeAll()
        byScope.removeAll()
        currentScopes.removeAll()
        orderedLoopIds.removeAll()
        labelByLoop.removeAll()
        sessionsByScope = []
    }
}
