import SwiftUI

/// What the active form sheet is editing/creating.
private enum VisionFormSheet: Identifiable {
    case goal(Goal?)
    case scenario(Scenario?)
    case document(DocumentRec?)

    var id: String {
        switch self {
        case .goal(let g): return "goal-\(g?.id ?? "new")"
        case .scenario(let s): return "scenario-\(s?.id ?? "new")"
        case .document(let d): return "document-\(d?.id ?? "new")"
        }
    }
}

/// What item a pending delete confirmation targets.
private enum VisionDeleteTarget: Identifiable {
    case goal(Goal)
    case scenario(Scenario)
    case document(DocumentRec)

    var id: String {
        switch self {
        case .goal(let g): return "goal-\(g.id)"
        case .scenario(let s): return "scenario-\(s.id)"
        case .document(let d): return "document-\(d.id)"
        }
    }

    var label: String {
        switch self {
        case .goal(let g): return g.title ?? g.id
        case .scenario(let s): return s.title ?? s.id
        case .document(let d): return d.title ?? d.id
        }
    }
}

struct VisionTabView: View {
    @ObservedObject var store: ProjectDetailStore
    @StateObject private var tabStore = VisionTabStore()

    @State private var activeSheet: VisionFormSheet?
    @State private var deleteTarget: VisionDeleteTarget?
    @State private var deleteError: String?

    // Convenience accessors
    private var scenarios: [Scenario] { store.scenarios.data }
    private var goals: [Goal]         { store.goals.data }
    private var documents: [DocumentRec] { store.documents.data }
    private var allScores: [Score]    { tabStore.allScores.data }
    private var allTestRuns: [TestRun] { tabStore.allTestRuns.data }
    private var allVerifications: [Verification] { tabStore.allVerifications.data }
    private var visionChanges: [VisionChange] { tabStore.visionChanges.data }

    private var loopIds: [String] { store.loops.data.map(\.id) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Add affordance (editable projects only)
                if store.editable {
                    addMenu
                }

                // Scenarios met banner (all-scope)
                if !scenarios.isEmpty {
                    let stats = summarize(scenarios.map(\.asRec),
                                         scores: allScores.map(\.asRec),
                                         testRuns: allTestRuns.map(\.asRec))
                    ScenariosMetBanner(met: stats.met, total: stats.total)
                }

                // Vision section: goals + scenarios
                if !scenarios.isEmpty {
                    visionSection
                }

                // Documents section
                if !documents.isEmpty {
                    documentsSection
                }

                // Vision changes feed (changes made by loops)
                if !visionChanges.isEmpty {
                    VisionChangesFeed(changes: visionChanges) { id in
                        Task { await tabStore.reject(id) }
                    }
                    .padding(.horizontal)
                }

                // Empty state when nothing is loaded yet
                if scenarios.isEmpty && documents.isEmpty {
                    if store.scenarios.loading || store.documents.loading {
                        HStack { Spacer(); Spinner(); Spacer() }
                            .padding()
                    } else {
                        EmptyState(text: "No vision content yet")
                    }
                }
            }
            .padding(.vertical)
        }
        .onAppear {
            tabStore.subscribe(teamId: store.teamId, slug: store.slug, loopIds: loopIds)
        }
        .onChange(of: store.loops.data.map(\.id)) { ids in
            tabStore.subscribe(teamId: store.teamId, slug: store.slug, loopIds: ids)
        }
        .onDisappear {
            tabStore.stop()
        }
        .sheet(item: $activeSheet) { sheet in
            formSheet(sheet)
        }
        .confirmationDialog(
            deleteTarget.map { "Delete “\($0.label)”?" } ?? "",
            isPresented: Binding(get: { deleteTarget != nil },
                                 set: { if !$0 { deleteTarget = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let target = deleteTarget { performDelete(target) }
                deleteTarget = nil
            }
            Button("Cancel", role: .cancel) { deleteTarget = nil }
        }
        .alert("Delete failed", isPresented: Binding(get: { deleteError != nil },
                                                     set: { if !$0 { deleteError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(deleteError ?? "") }
    }

    // MARK: - Add menu

    private var addMenu: some View {
        Menu {
            Button { activeSheet = .goal(nil) } label: { Label("Add goal", systemImage: "target") }
            Button { activeSheet = .scenario(nil) } label: { Label("Add scenario", systemImage: "list.bullet.rectangle") }
            Button { activeSheet = .document(nil) } label: { Label("Add document", systemImage: "doc.text") }
        } label: {
            Label("Add", systemImage: "plus.circle.fill")
                .font(.headline)
        }
        .padding(.horizontal)
    }

    // MARK: - Form sheets

    @ViewBuilder
    private func formSheet(_ sheet: VisionFormSheet) -> some View {
        switch sheet {
        case .goal(let goal):
            GoalFormView(initial: goal) { body in
                try await saveGoal(body, existing: goal)
            }
        case .scenario(let scenario):
            ScenarioFormView(initial: scenario, goals: goals) { body in
                try await saveScenario(body, existing: scenario)
            }
        case .document(let doc):
            DocumentFormView(initial: doc) { body in
                try await saveDocument(body, existing: doc)
            }
        }
    }

    // MARK: - Save wiring

    private func saveGoal(_ body: GoalBody, existing: Goal?) async throws {
        let id = existing?.id ?? genId(title: body.title, taken: goals.map(\.id), prefix: "goal")
        try await RestClient.putGoal(teamId: store.teamId, slug: store.slug, id: id, body: body)
    }

    private func saveScenario(_ body: ScenarioBody, existing: Scenario?) async throws {
        let id = existing?.id ?? genId(title: body.title, taken: scenarios.map(\.id), prefix: "scenario")
        try await RestClient.putScenario(teamId: store.teamId, slug: store.slug, id: id, body: body)
    }

    private func saveDocument(_ body: DocumentBody, existing: DocumentRec?) async throws {
        let id = existing?.id ?? genId(title: body.title, taken: documents.map(\.id), prefix: "document")
        try await RestClient.putDocument(teamId: store.teamId, slug: store.slug, id: id, body: body)
    }

    // MARK: - Delete wiring

    private func performDelete(_ target: VisionDeleteTarget) {
        Task { @MainActor in
            do {
                switch target {
                case .goal(let g):
                    try await RestClient.deleteGoal(teamId: store.teamId, slug: store.slug, id: g.id)
                case .scenario(let s):
                    try await RestClient.deleteScenario(teamId: store.teamId, slug: store.slug, id: s.id)
                case .document(let d):
                    try await RestClient.deleteDocument(teamId: store.teamId, slug: store.slug, id: d.id)
                }
                // On success the live listener drops the item — no local mutation.
            } catch {
                deleteError = error.localizedDescription
            }
        }
    }

    // MARK: - Vision section

    private var visionSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Vision")
                .font(.title3.bold())
                .padding(.horizontal)

            // Goals that have scenarios
            ForEach(goals, id: \.id) { goal in
                let items = scenarios.filter { $0.goalId == goal.id }
                if !items.isEmpty {
                    goalBlock(goal: goal, items: items)
                }
            }

            // Ungrouped scenarios (goalId matches no known goal)
            let goalIds = Set(goals.map(\.id))
            let orphaned = scenarios.filter { s in
                guard let gid = s.goalId else { return true }
                return !goalIds.contains(gid)
            }
            if !orphaned.isEmpty {
                ungroupedBlock(items: orphaned)
            }
        }
    }

    private func goalBlock(goal: Goal, items: [Scenario]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(goal.title ?? goal.id)
                        .font(.headline)
                    if store.editable {
                        Spacer()
                        editDeleteMenu(
                            edit: { activeSheet = .goal(goal) },
                            delete: { deleteTarget = .goal(goal) }
                        )
                    }
                }
                .padding(.horizontal)
                if let desc = goal.description {
                    Text(desc)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal)
                }
            }
            ForEach(items, id: \.id) { scenario in
                scenarioRow(scenario)
            }
        }
    }

    private func ungroupedBlock(items: [Scenario]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Ungrouped")
                .font(.headline)
                .foregroundStyle(.secondary)
                .padding(.horizontal)
            ForEach(items, id: \.id) { scenario in
                scenarioRow(scenario)
            }
        }
    }

    private func scenarioRow(_ scenario: Scenario) -> some View {
        ScenarioCard(scenario: scenario,
                     scores: allScores,
                     testRuns: allTestRuns,
                     verifications: allVerifications)
            .padding(.horizontal)
            .modifier(EditDeleteContextMenu(
                enabled: store.editable,
                edit: { activeSheet = .scenario(scenario) },
                delete: { deleteTarget = .scenario(scenario) }
            ))
    }

    // MARK: - Documents section

    private var documentsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Documents")
                .font(.title3.bold())
                .padding(.horizontal)
            ForEach(documents, id: \.id) { doc in
                DocumentRow(document: doc)
                    .padding(.horizontal)
                    .modifier(EditDeleteContextMenu(
                        enabled: store.editable,
                        edit: { activeSheet = .document(doc) },
                        delete: { deleteTarget = .document(doc) }
                    ))
            }
        }
    }

    // MARK: - Reusable edit/delete affordances

    private func editDeleteMenu(edit: @escaping () -> Void, delete: @escaping () -> Void) -> some View {
        Menu {
            Button { edit() } label: { Label("Edit", systemImage: "pencil") }
            Button(role: .destructive) { delete() } label: { Label("Delete", systemImage: "trash") }
        } label: {
            Image(systemName: "ellipsis.circle")
                .foregroundStyle(.secondary)
        }
    }
}

/// Attaches an edit/delete context menu to a card when `enabled`.
private struct EditDeleteContextMenu: ViewModifier {
    let enabled: Bool
    let edit: () -> Void
    let delete: () -> Void

    func body(content: Content) -> some View {
        if enabled {
            content.contextMenu {
                Button { edit() } label: { Label("Edit", systemImage: "pencil") }
                Button(role: .destructive) { delete() } label: { Label("Delete", systemImage: "trash") }
            }
        } else {
            content
        }
    }
}
