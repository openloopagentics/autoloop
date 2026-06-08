import SwiftUI

/// Mirrors LoopSelector.tsx: a labelled Menu/Picker over the selectable loops.
struct LoopPicker: View {
    let loops: [SelectableLoop]
    @Binding var selectedId: String

    private func label(for l: SelectableLoop) -> String {
        let base = l.isMain ? "main (legacy)" : (l.name ?? l.goal ?? l.id)
        return base + (l.status.map { " — \($0)" } ?? "")
    }

    var body: some View {
        HStack(spacing: 8) {
            Text("Loop").font(.caption).foregroundStyle(.secondary)
            Picker("Loop", selection: $selectedId) {
                ForEach(loops, id: \.id) { l in
                    Text(label(for: l)).tag(l.id)
                }
            }
            .pickerStyle(.menu)
            Spacer()
        }
    }
}
