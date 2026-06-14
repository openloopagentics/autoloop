import SwiftUI

struct DashboardView: View {
    @Environment(\.palette) private var palette
    @StateObject private var store = DashboardStore()
    @State private var renaming: ProjectRow?
    @State private var newTitle = ""
    @State private var writeError: String?
    @State private var showNew = false
    @State private var createdTarget: ProjectRow?
    @State private var deleting: ProjectRow?

    var body: some View {
        Group {
            if store.loading { Spinner(label: "Loading projects…") }
            else if let e = store.error { ErrorNote(message: e) }
            else if store.rows.isEmpty { EmptyState(text: "No projects yet.") }
            else {
                List(store.rows) { row in
                    NavigationLink {
                        ProjectDetailView(teamId: row.teamId, slug: row.project.slug)
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.project.title ?? row.project.slug)
                                    .font(.serif(16)).foregroundStyle(palette.fg)
                                Text(row.teamId).font(.caption).foregroundStyle(palette.fgMeta)
                            }
                            Spacer()
                            ProjectStatusBadge(teamId: row.teamId, slug: row.project.slug,
                                               fallback: row.project.status)
                        }
                    }
                    .listRowBackground(palette.surfaceRaised)
                    .listRowSeparatorTint(palette.borderSoft)
                    .swipeActions {
                        Button("Rename") { renaming = row; newTitle = row.project.title ?? "" }
                        if store.canDelete(teamId: row.teamId) {
                            Button("Delete", role: .destructive) { deleting = row }
                        }
                    }
                    .contextMenu {
                        if store.canDelete(teamId: row.teamId) {
                            Button("Delete", role: .destructive) { deleting = row }
                        }
                    }
                }
                .scrollContentBackground(.hidden)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .appBackground(palette)
        .navigationTitle("Dashboard")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { store.start() }
        .onDisappear { store.stop() }
        .toolbar {
            if !store.teams.isEmpty {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { showNew = true } label: { Image(systemName: "plus") }
                }
            }
        }
        .sheet(isPresented: $showNew) {
            NewProjectFormView(teams: store.teams) { teamId, slug, title in
                try await RestClient.putProject(teamId: teamId, slug: slug, title: title)
                createdTarget = ProjectRow(teamId: teamId, project: Project(slug: slug, title: title))
            }
        }
        .navigationDestination(
            isPresented: Binding(get: { createdTarget != nil }, set: { if !$0 { createdTarget = nil } })
        ) {
            if let row = createdTarget {
                ProjectDetailView(teamId: row.teamId, slug: row.project.slug)
            }
        }
        .alert("Rename project", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Title", text: $newTitle)
            Button("Save") { Task { await save() } }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
        .confirmationDialog(
            deleting.map { "Delete project \"\($0.project.slug)\"? This cannot be undone." } ?? "",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) { if let row = deleting { Task { await delete(row) } } }
            Button("Cancel", role: .cancel) { deleting = nil }
        }
        .alert("Write failed", isPresented: Binding(get: { writeError != nil }, set: { if !$0 { writeError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(writeError ?? "") }
    }

    private func save() async {
        guard let row = renaming else { return }
        do {
            try await RestClient.putProject(teamId: row.teamId, slug: row.project.slug,
                                            title: newTitle, status: row.project.status ?? "running")
            renaming = nil
        } catch { writeError = error.localizedDescription }
    }

    private func delete(_ row: ProjectRow) async {
        deleting = nil
        do {
            try await RestClient.deleteProject(teamId: row.teamId, slug: row.project.slug)
        } catch { writeError = error.localizedDescription }
    }
}

/// A project's EFFECTIVE status badge — mirrors web's ProjectCardContainer: derive it from the
/// project's loops (running only if a loop genuinely is; zombie→paused; else latest loop's status),
/// falling back to the stored project status. A per-project loops listener, like web's useLoops.
private struct ProjectStatusBadge: View {
    let teamId: String
    let slug: String
    let fallback: String?
    @StateObject private var loops = CollectionStore<Loop>()

    private var status: String? {
        effectiveProjectStatus(loops.data.map(\.asStatusLoop), projectStatus: fallback)
    }

    var body: some View {
        Group {
            if let s = status { StatusBadge(status: s) }
        }
        .onAppear {
            loops.start(query: loopsQuery(teamId: teamId, slug: slug)) { Loop(id: $0.documentID, data: $0.data()) }
        }
        .onDisappear { loops.stop() }
    }
}
