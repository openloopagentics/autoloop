import Foundation
import FirebaseFirestore

// MARK: - Pure merge function (testable)

/// Filter byScope to only keys in `current`, then flatten all values.
/// Mirrors hooks.ts: `Object.entries(byScope).filter(([k]) => current.has(k)).flatMap(([,v]) => v)`
func mergeScopes<T>(byScope: [String: [T]], current: Set<String>) -> [T] {
    byScope.filter { current.contains($0.key) }.flatMap { $0.value }
}

// MARK: - AllScopeStore

/// Mirrors useAllTestRuns/useAllScores/useAllBugs: fans out one QueryListener per scope
/// (project-direct "__main__" + each loop id), merges, and drops stale scopes.
@MainActor
final class AllScopeStore<T>: ObservableObject {
    @Published var data: [T] = []
    @Published var loading = true
    @Published var error: String?

    /// Called each time a scope snapshot arrives; returns stamped items for that scope.
    typealias QueryBuilder = (_ loopId: String?) -> Query
    typealias Mapper = (_ doc: QueryDocumentSnapshot, _ loopId: String?) -> T?

    private var byScope: [String: [T]] = [:]
    private var listeners: [String: QueryListener<[T]>] = [:]
    private var currentScopes: Set<String> = []

    /// Call this whenever the set of active loop ids changes (include nil scope as "__main__").
    /// `loopIds` = the current loop document IDs (project-direct scope is always added internally).
    func update(loopIds: [String], queryBuilder: @escaping QueryBuilder, mapper: @escaping Mapper) {
        let newScopes: Set<String> = Set(["__main__"] + loopIds)

        // Remove gone scopes
        for gone in currentScopes.subtracting(newScopes) {
            listeners[gone]?.stop()
            listeners[gone] = nil
            byScope[gone] = nil
        }

        // Add new scopes
        for scopeKey in newScopes.subtracting(currentScopes) {
            let loopId: String? = scopeKey == "__main__" ? nil : scopeKey
            let ql = QueryListener<[T]>()
            let query = queryBuilder(loopId)
            ql.start(query, map: { docs in
                docs.compactMap { mapper($0, loopId) }
            }, onChange: { [weak self] result in
                Task { @MainActor in
                    guard let self else { return }
                    switch result {
                    case .failure(let e):
                        self.error = e.localizedDescription
                        self.loading = false
                    case .success(let items):
                        self.byScope[scopeKey] = items
                        self.publish()
                    }
                }
            })
            listeners[scopeKey] = ql
        }

        currentScopes = newScopes
        publish()
        loading = false
    }

    private func publish() {
        data = mergeScopes(byScope: byScope, current: currentScopes)
    }

    func stop() {
        listeners.values.forEach { $0.stop() }
        listeners.removeAll()
        byScope.removeAll()
        currentScopes.removeAll()
    }
}
