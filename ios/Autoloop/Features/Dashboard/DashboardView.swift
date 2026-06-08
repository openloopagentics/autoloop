import SwiftUI

struct DashboardView: View {
    @StateObject private var store = DashboardStore()
    @State private var renaming: ProjectRow?
    @State private var newTitle = ""
    @State private var writeError: String?

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
                            VStack(alignment: .leading) {
                                Text(row.project.title ?? row.project.slug).font(.headline)
                                Text(row.teamId).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if let s = row.project.status { StatusBadge(status: s) }
                        }
                    }
                    .swipeActions {
                        Button("Rename") { renaming = row; newTitle = row.project.title ?? "" }
                    }
                }
            }
        }
        .navigationTitle("Dashboard")
        .onAppear { store.start() }
        .onDisappear { store.stop() }
        .alert("Rename project", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Title", text: $newTitle)
            Button("Save") { Task { await save() } }
            Button("Cancel", role: .cancel) { renaming = nil }
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
}
