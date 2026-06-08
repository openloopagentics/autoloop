import Foundation
import FirebaseFirestore

// MARK: - CollectionStore

/// Generic @MainActor store wrapping a single QueryListener.
@MainActor
final class CollectionStore<T>: ObservableObject {
    @Published var data: [T] = []
    @Published var loading = true
    @Published var error: String?

    private let listener = QueryListener<[T]>()

    func start(query: Query, map: @escaping (QueryDocumentSnapshot) -> T?) {
        listener.start(query, map: { docs in
            docs.compactMap { map($0) }
        }, onChange: { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                switch result {
                case .failure(let e):
                    self.error = e.localizedDescription
                    self.loading = false
                case .success(let items):
                    self.data = items
                    self.loading = false
                }
            }
        })
    }

    func stop() { listener.stop() }
}

// MARK: - Path helpers

/// Walk basePath segments (alternating collection/doc) to a CollectionReference for `name`.
func collectionRef(segments: [String], name: String) -> CollectionReference {
    let db = Firestore.firestore()
    precondition(segments.count >= 2 && segments.count % 2 == 0,
                 "basePath must have even length ≥ 2")
    var ref = db.collection(segments[0]).document(segments[1])
    var idx = 2
    while idx + 1 < segments.count {
        ref = ref.collection(segments[idx]).document(segments[idx + 1])
        idx += 2
    }
    return ref.collection(name)
}

// MARK: - Project-level query builders (teams/{t}/projects/{s}/<name>)

func loopsQuery(teamId: String, slug: String) -> Query {
    Firestore.firestore()
        .collection("teams").document(teamId)
        .collection("projects").document(slug)
        .collection("loops")
        .order(by: "order")
}

func goalsQuery(teamId: String, slug: String) -> Query {
    Firestore.firestore()
        .collection("teams").document(teamId)
        .collection("projects").document(slug)
        .collection("goals")
        .order(by: "order")
}

func scenariosQuery(teamId: String, slug: String) -> Query {
    Firestore.firestore()
        .collection("teams").document(teamId)
        .collection("projects").document(slug)
        .collection("scenarios")
        .order(by: "order")
}

func documentsQuery(teamId: String, slug: String) -> Query {
    Firestore.firestore()
        .collection("teams").document(teamId)
        .collection("projects").document(slug)
        .collection("documents")
        .order(by: FieldPath.documentID())
}

func messagesQuery(teamId: String, slug: String) -> Query {
    Firestore.firestore()
        .collection("teams").document(teamId)
        .collection("projects").document(slug)
        .collection("messages")
        .order(by: FieldPath.documentID())
}

// MARK: - Loop-scoped query builders (basePath + collection)

func phasesQuery(teamId: String, slug: String, loopId: String?) -> Query {
    collectionRef(segments: basePath(teamId: teamId, slug: slug, loopId: loopId), name: "phases")
        .order(by: "order")
}

func tasksQuery(teamId: String, slug: String, loopId: String?) -> Query {
    collectionRef(segments: basePath(teamId: teamId, slug: slug, loopId: loopId), name: "tasks")
        .order(by: "order")
}

func scoresQuery(teamId: String, slug: String, loopId: String?) -> Query {
    collectionRef(segments: basePath(teamId: teamId, slug: slug, loopId: loopId), name: "scores")
        .order(by: FieldPath.documentID())
}

func testRunsQuery(teamId: String, slug: String, loopId: String?) -> Query {
    collectionRef(segments: basePath(teamId: teamId, slug: slug, loopId: loopId), name: "testRuns")
        .order(by: FieldPath.documentID())
}

func revisionsQuery(teamId: String, slug: String, loopId: String?) -> Query {
    collectionRef(segments: basePath(teamId: teamId, slug: slug, loopId: loopId), name: "revisions")
        .order(by: FieldPath.documentID())
}

func sessionsQuery(teamId: String, slug: String, loopId: String?) -> Query {
    collectionRef(segments: basePath(teamId: teamId, slug: slug, loopId: loopId), name: "sessions")
        .order(by: "startedAt")
}

func bugsQuery(teamId: String, slug: String, loopId: String?) -> Query {
    collectionRef(segments: basePath(teamId: teamId, slug: slug, loopId: loopId), name: "bugs")
        .order(by: FieldPath.documentID())
}

// MARK: - Lazy subcollection query builders

/// Commits for a phase: basePath/.../phases/{phaseId}/commits ordered by createdAt desc.
func commitsQuery(teamId: String, slug: String, phaseId: String, loopId: String?) -> Query {
    collectionRef(segments: basePath(teamId: teamId, slug: slug, loopId: loopId), name: "phases")
        .document(phaseId)
        .collection("commits")
        .order(by: "createdAt", descending: true)
}

/// Task commits: basePath/.../tasks/{taskId}/commits ordered by createdAt desc.
func taskCommitsQuery(teamId: String, slug: String, taskId: String, loopId: String?) -> Query {
    collectionRef(segments: basePath(teamId: teamId, slug: slug, loopId: loopId), name: "tasks")
        .document(taskId)
        .collection("commits")
        .order(by: "createdAt", descending: true)
}
