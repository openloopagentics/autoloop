import Foundation
import FirebaseFirestore

struct Loadable<T> {
    var data: T
    var loading: Bool = true
    var error: String? = nil
}

/// Thin wrapper so feature stores stay testable; mirrors hooks.ts Result<T>.
final class QueryListener<T> {
    private var reg: ListenerRegistration?
    func start(_ query: Query, map: @escaping ([QueryDocumentSnapshot]) -> T,
               onChange: @escaping (Result<T, Error>) -> Void) {
        reg?.remove()
        reg = query.addSnapshotListener { snap, err in
            if let err { onChange(.failure(err)); return }
            onChange(.success(map(snap?.documents ?? [])))
        }
    }
    func stop() { reg?.remove(); reg = nil }
    deinit { stop() }
}
