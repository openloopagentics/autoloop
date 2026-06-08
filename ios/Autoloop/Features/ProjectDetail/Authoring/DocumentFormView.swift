import SwiftUI

/// Sheet to create or edit a Document. Mirrors web DocumentForm.tsx.
struct DocumentFormView: View {
    let initial: DocumentRec?
    let onSave: (DocumentBody) async throws -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var kind: String
    @State private var title: String
    @State private var format: String
    @State private var content: String
    @State private var pending = false
    @State private var error: String?

    private static let maxContent = 100 * 1024

    init(initial: DocumentRec?, onSave: @escaping (DocumentBody) async throws -> Void) {
        self.initial = initial
        self.onSave = onSave
        _kind = State(initialValue: initial?.kind ?? "")
        _title = State(initialValue: initial?.title ?? "")
        _format = State(initialValue: initial?.format ?? "markdown")
        _content = State(initialValue: initial?.content ?? "")
    }

    private var editing: Bool { initial != nil }
    private var tooBig: Bool { content.utf8.count > Self.maxContent }

    private var canSubmit: Bool {
        !kind.trimmingCharacters(in: .whitespaces).isEmpty
            && !title.trimmingCharacters(in: .whitespaces).isEmpty
            && !content.trimmingCharacters(in: .whitespaces).isEmpty
            && !tooBig
            && !pending
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Kind — e.g. spec", text: $kind)
                    TextField("Document title", text: $title)
                    Picker("Format", selection: $format) {
                        Text("markdown").tag("markdown")
                        Text("url").tag("url")
                    }
                }
                Section("Content") {
                    TextEditor(text: $content)
                        .frame(minHeight: 160)
                    if tooBig {
                        Text("Content exceeds 100KB.")
                            .font(.footnote).foregroundStyle(.red)
                    }
                }
                if let error {
                    Section { ErrorNote(message: error) }
                }
            }
            .navigationTitle(editing ? "Save document" : "Add document")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save).disabled(!canSubmit)
                }
            }
        }
    }

    private func save() {
        guard canSubmit else { return }
        pending = true
        error = nil
        let body = DocumentBody(
            kind: kind.trimmingCharacters(in: .whitespaces),
            title: title.trimmingCharacters(in: .whitespaces),
            format: format,
            content: content
        )
        Task {
            do {
                try await onSave(body)
                pending = false
                dismiss()
            } catch {
                self.error = error.localizedDescription
                pending = false
            }
        }
    }
}
