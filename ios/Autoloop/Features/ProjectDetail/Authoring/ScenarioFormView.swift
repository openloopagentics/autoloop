import SwiftUI

/// Sheet to create or edit a Scenario, including its rubric criteria.
/// Mirrors web ScenarioForm.tsx.
struct ScenarioFormView: View {
    let initial: Scenario?
    let goals: [Goal]
    let onSave: (ScenarioBody) async throws -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var goalId: String
    @State private var title: String
    @State private var description: String
    @State private var order: String
    @State private var threshold: String
    @State private var rows: [CriterionRow]
    @State private var pending = false
    @State private var error: String?

    private static func emptyRow() -> CriterionRow { CriterionRow(name: "", weight: "1", max: "5") }

    init(initial: Scenario?, goals: [Goal], onSave: @escaping (ScenarioBody) async throws -> Void) {
        self.initial = initial
        self.goals = goals
        self.onSave = onSave
        _goalId = State(initialValue: initial?.goalId ?? "")
        _title = State(initialValue: initial?.title ?? "")
        _description = State(initialValue: initial?.description ?? "")
        _order = State(initialValue: initial?.order.map(String.init) ?? "")
        _threshold = State(initialValue: initial?.threshold.map(String.init) ?? "")
        if let criteria = initial?.rubric, !criteria.isEmpty {
            _rows = State(initialValue: criteria.map {
                CriterionRow(name: $0.name, weight: String($0.weight), max: String(Int($0.max)))
            })
        } else {
            _rows = State(initialValue: [Self.emptyRow()])
        }
    }

    private var editing: Bool { initial != nil }

    private var thresholdValid: Bool {
        let t = threshold.trimmingCharacters(in: .whitespaces)
        if t.isEmpty { return true }
        guard let n = Int(t) else { return false }
        return n >= 0 && n <= 100
    }

    private var rowsValid: Bool {
        !rows.isEmpty && rows.allSatisfy(rowIsValid)
    }

    private var canSubmit: Bool {
        !title.trimmingCharacters(in: .whitespaces).isEmpty && rowsValid && thresholdValid && !pending
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Scenario title", text: $title)
                    TextField("Description (optional)", text: $description)
                    Picker("Goal", selection: $goalId) {
                        Text("(no goal)").tag("")
                        ForEach(goals, id: \.id) { g in
                            Text(g.title ?? g.id).tag(g.id)
                        }
                    }
                    TextField("Order", text: $order)
                        .keyboardType(.numbersAndPunctuation)
                    TextField("Threshold 0-100", text: $threshold)
                        .keyboardType(.numbersAndPunctuation)
                    if !thresholdValid {
                        Text("Threshold must be 0–100.")
                            .font(.footnote).foregroundStyle(.red)
                    }
                }

                Section("Rubric criteria") {
                    ForEach(rows.indices, id: \.self) { i in
                        VStack(spacing: 6) {
                            TextField("Name", text: $rows[i].name)
                            HStack {
                                TextField("Weight", text: $rows[i].weight)
                                    .keyboardType(.decimalPad)
                                TextField("Max", text: $rows[i].max)
                                    .keyboardType(.numberPad)
                                Button(role: .destructive) {
                                    rows.remove(at: i)
                                } label: {
                                    Image(systemName: "minus.circle")
                                }
                                .disabled(rows.count == 1)
                                .buttonStyle(.borderless)
                            }
                        }
                    }
                    Button {
                        rows.append(Self.emptyRow())
                    } label: {
                        Label("Add criterion", systemImage: "plus")
                    }
                }

                if let error {
                    Section { ErrorNote(message: error) }
                }
            }
            .navigationTitle(editing ? "Save scenario" : "Add scenario")
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
        let thr = threshold.trimmingCharacters(in: .whitespaces)
        let rubric = RubricBody(criteria: buildRubricCriteria(rows).map {
            RubricCriterionBody(id: $0.id, name: $0.name, weight: $0.weight, max: $0.max)
        })
        let body = ScenarioBody(
            goalId: goalId.isEmpty ? nil : goalId,
            title: title.trimmingCharacters(in: .whitespaces),
            description: desc.isEmpty ? nil : desc,
            order: ord.isEmpty ? nil : Int(ord),
            threshold: thr.isEmpty ? nil : Int(thr),
            rubric: rubric
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
