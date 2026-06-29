import Foundation
import Combine
import FirebaseFirestore

/// Project-level data + loop selection for the project-detail screen.
///
/// Owns a project doc listener plus project-level collection stores (loops/goals/
/// scenarios/documents) and the project-direct phases/tasks used only to decide
/// whether to synthesise a legacy "main" loop. Child `CollectionStore`s are nested
/// `ObservableObject`s; we forward their `objectWillChange` so SwiftUI re-renders
/// when any child's `data` changes, and read `.data` directly in computed props.
@MainActor
final class ProjectDetailStore: ObservableObject {
    let teamId: String
    let slug: String

    @Published private(set) var project: Project?
    /// True once the project doc has resolved (so `project == nil` means "not found").
    @Published private(set) var projectResolved = false
    /// User's explicit loop pick; empty means "use default".
    @Published var selectedId: String = ""
    /// Surfaces a failure from the project-doc snapshot listener; nil while healthy.
    @Published var error: String?

    let loops = CollectionStore<Loop>()
    let goals = CollectionStore<Goal>()
    let scenarios = CollectionStore<Scenario>()
    let documents = CollectionStore<DocumentRec>()
    // Project-direct (loopId nil) — only to compute hasProjectDirectData for `main` synthesis.
    let directPhases = CollectionStore<Phase>()
    let directTasks = CollectionStore<ProjectTask>()

    private let db = Firestore.firestore()
    private var projectReg: ListenerRegistration?
    private var bag: Set<AnyCancellable> = []

    init(teamId: String, slug: String) {
        self.teamId = teamId
        self.slug = slug
        // Re-publish on any child change so views observing `self` refresh.
        for child in [loops.objectWillChange, goals.objectWillChange, scenarios.objectWillChange,
                      documents.objectWillChange, directPhases.objectWillChange,
                      directTasks.objectWillChange] {
            child.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
        }
    }

    // MARK: - Computed (via SP1 pure funcs + Rec mappers)

    var hasProjectDirectData: Bool { !directPhases.data.isEmpty || !directTasks.data.isEmpty }

    var loopList: [SelectableLoop] {
        buildLoopList(loops.data.map(\.asLoopRec), project: project?.asProjectRec,
                      hasProjectDirectData: hasProjectDirectData)
    }

    var effectiveStatus: String? {
        effectiveProjectStatus(loops.data.map(\.asStatusLoop), projectStatus: project?.status)
    }

    var resolvedSelectedId: String {
        if !selectedId.isEmpty, loopList.contains(where: { $0.id == selectedId }) { return selectedId }
        return defaultSelectedLoop(loopList, currentLoopId: project?.currentLoopId)
    }

    var selectedLoop: SelectableLoop? { loopList.first { $0.id == resolvedSelectedId } }

    var loopArg: String? { loopArgFor(selectedLoop) }

    var agentActive: Bool {
        loops.data.contains { $0.status == "running" }
            || (loops.data.isEmpty && project?.status == "running")
    }

    var editable: Bool { project != nil && project?.visionOwner != "loop" }

    var notFound: Bool { projectResolved && project == nil }

    // MARK: - Lifecycle

    func start() {
        startProjectListener()
        loops.start(query: loopsQuery(teamId: teamId, slug: slug)) { Loop(id: $0.documentID, data: $0.data()) }
        goals.start(query: goalsQuery(teamId: teamId, slug: slug)) { Goal(id: $0.documentID, data: $0.data()) }
        scenarios.start(query: scenariosQuery(teamId: teamId, slug: slug)) { Scenario(id: $0.documentID, data: $0.data()) }
        documents.start(query: documentsQuery(teamId: teamId, slug: slug)) { DocumentRec(id: $0.documentID, data: $0.data()) }
        directPhases.start(query: phasesQuery(teamId: teamId, slug: slug, loopId: nil)) { Phase(id: $0.documentID, data: $0.data()) }
        directTasks.start(query: tasksQuery(teamId: teamId, slug: slug, loopId: nil)) { ProjectTask(id: $0.documentID, data: $0.data()) }
    }

    func stop() {
        projectReg?.remove(); projectReg = nil
        loops.stop(); goals.stop(); scenarios.stop(); documents.stop()
        directPhases.stop(); directTasks.stop()
    }

    private func startProjectListener() {
        projectReg?.remove()
        projectReg = db.collection("teams").document(teamId)
            .collection("projects").document(slug)
            .addSnapshotListener { [weak self] snap, err in
                Task { @MainActor in
                    guard let self else { return }
                    if let err {
                        self.error = err.localizedDescription
                        self.projectResolved = true
                        return
                    }
                    self.error = nil
                    if let snap, snap.exists, let data = snap.data() {
                        self.project = Project(slug: snap.documentID, data: data)
                    } else {
                        self.project = nil
                    }
                    self.projectResolved = true
                }
            }
    }
}
