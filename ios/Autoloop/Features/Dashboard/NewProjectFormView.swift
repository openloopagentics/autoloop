import SwiftUI

/// Sheet to create a new project from the Dashboard. Mirrors web NewProjectForm.tsx.
struct NewProjectFormView: View {
    let teams: [TeamRef]
    let onCreate: (_ teamId: String, _ slug: String, _ title: String) async throws -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var teamId: String = ""
    @State private var slug: String = ""
    @State private var title: String = ""
    @State private var pending = false
    @State private var error: String?

    private var trimmedSlug: String { slug.trimmingCharacters(in: .whitespaces) }
    private var slugValid: Bool { isValidSlug(slug) }
    private var canSubmit: Bool {
        !teamId.isEmpty && slugValid
            && !title.trimmingCharacters(in: .whitespaces).isEmpty && !pending
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Team", selection: $teamId) {
                        ForEach(teams) { t in
                            Text(t.teamId).tag(t.teamId)
                        }
                    }
                    TextField("Slug — e.g. web", text: $slug)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                    if !trimmedSlug.isEmpty && !slugValid {
                        Text("Slug must match a-z, 0-9, dot, dash, underscore.")
                            .font(.caption).foregroundStyle(.red)
                    }
                    TextField("Project title", text: $title)
                }
                if let error {
                    Section { ErrorNote(message: error) }
                }
            }
            .navigationTitle("New project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create", action: create).disabled(!canSubmit)
                }
            }
            .onAppear {
                if teamId.isEmpty { teamId = teams.first?.teamId ?? "" }
            }
        }
    }

    private func create() {
        guard canSubmit else { return }
        pending = true
        error = nil
        let tid = teamId
        let s = trimmedSlug
        let t = title.trimmingCharacters(in: .whitespaces)
        Task {
            do {
                try await onCreate(tid, s, t)
                pending = false
                dismiss()
            } catch {
                self.error = error.localizedDescription
                pending = false
            }
        }
    }
}
