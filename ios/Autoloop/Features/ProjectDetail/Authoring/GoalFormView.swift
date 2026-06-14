import SwiftUI

/// Sheet to create or edit a Goal. Mirrors web GoalForm.tsx.
struct GoalFormView: View {
    let initial: Goal?
    let onSave: (GoalBody) async throws -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var title: String
    @State private var description: String
    @State private var order: String
    @State private var pending = false
    @State private var error: String?

    init(initial: Goal?, onSave: @escaping (GoalBody) async throws -> Void) {
        self.initial = initial
        self.onSave = onSave
        _title = State(initialValue: initial?.title ?? "")
        _description = State(initialValue: initial?.description ?? "")
        _order = State(initialValue: initial?.order.map(String.init) ?? "")
    }

    private var editing: Bool { initial != nil }
    private var canSubmit: Bool { !title.trimmingCharacters(in: .whitespaces).isEmpty && !pending }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Goal title", text: $title)
                    TextField("Description (optional)", text: $description)
                    TextField("Order", text: $order)
                        .keyboardType(.numbersAndPunctuation)
                }
                if let error {
                    Section { ErrorNote(message: error) }
                }
            }
            .navigationTitle(editing ? "Save goal" : "Add goal")
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
        let desc = description.trimmingCharacters(in: .whitespaces)
        let ord = order.trimmingCharacters(in: .whitespaces)
        let body = GoalBody(
            title: title.trimmingCharacters(in: .whitespaces),
            description: desc.isEmpty ? nil : desc,
            order: ord.isEmpty ? nil : Int(ord)
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
