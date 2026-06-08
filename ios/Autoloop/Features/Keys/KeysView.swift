import SwiftUI

struct KeysView: View {
    @StateObject private var store = KeysStore()
    @State private var labelText = ""
    @State private var revokeTarget: KeyMeta?

    var body: some View {
        NavigationStack {
            List {
                // Hint
                Section {
                    Text("Mint keys for the autoloop CLI; set AUTOLOOP_API_KEY")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                // Mint form
                Section("Mint a key") {
                    HStack(spacing: 8) {
                        TextField("Label", text: $labelText)
                            .textFieldStyle(.roundedBorder)
                        Button("Mint") {
                            let label = labelText.trimmingCharacters(in: .whitespacesAndNewlines)
                            guard !label.isEmpty, !store.pending else { return }
                            labelText = ""
                            Task { await store.mint(label: label) }
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .disabled(labelText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.pending)
                    }
                    if store.pending { Spinner(label: "Minting…") }
                }

                // Reveal panel (one-time)
                if let secret = store.revealedKey {
                    Section {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Copy it now — it won't be shown again.")
                                .font(.footnote)
                                .foregroundStyle(.orange)
                            Text(secret)
                                .font(.system(.footnote, design: .monospaced))
                                .textSelection(.enabled)
                                .lineLimit(nil)
                            HStack(spacing: 12) {
                                Button("Copy") {
                                    UIPasteboard.general.string = secret
                                }
                                .buttonStyle(.bordered)
                                Button("Dismiss") {
                                    store.revealedKey = nil
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                        .padding(.vertical, 4)
                    } header: {
                        Text("New key — save it now")
                    }
                }

                // Error
                if let err = store.error {
                    Section { ErrorNote(message: err) }
                }

                // Key list
                Section("Your keys") {
                    if store.loading && store.keys.isEmpty {
                        Spinner(label: "Loading keys…")
                    } else if store.keys.isEmpty {
                        EmptyState(text: "No keys yet.")
                    } else {
                        ForEach(store.keys) { key in
                            KeyRowView(key: key) {
                                Task { await store.revoke(id: key.id) }
                            }
                        }
                    }
                }
            }
            .navigationTitle("API keys")
            .task { await store.refresh() }
        }
    }
}

private struct KeyRowView: View {
    let key: KeyMeta
    let onRevoke: () -> Void
    @State private var showConfirm = false

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(key.label).font(.body)
                Text("\(key.prefix)…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let ts = key.createdAt {
                    Text(Date(timeIntervalSince1970: ts / 1000), style: .date)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            Spacer()
            Button("Revoke", role: .destructive) { showConfirm = true }
                .buttonStyle(.bordered)
                .controlSize(.small)
        }
        .confirmationDialog("Revoke this key?", isPresented: $showConfirm, titleVisibility: .visible) {
            Button("Revoke", role: .destructive) { onRevoke() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The key \"\(key.label)\" will stop working immediately.")
        }
    }
}
