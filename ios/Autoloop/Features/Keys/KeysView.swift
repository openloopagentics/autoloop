import SwiftUI
import UIKit

/// API keys — the key list fills the screen; "mint a key" lives in the top toolbar (+), opening a
/// sheet that turns into the one-time secret reveal after minting (same pattern as Teams/Admin).
struct KeysView: View {
    @Environment(\.palette) private var palette
    @StateObject private var store = KeysStore()
    @State private var labelText = ""
    @State private var showMint = false

    var body: some View {
        // AppShell already wraps this tab in a NavigationStack — don't nest another.
        keyList
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .appBackground(palette)
            .navigationTitle("API keys")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { labelText = ""; store.error = nil; showMint = true } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("Mint key")
                }
            }
            .sheet(isPresented: $showMint, onDismiss: { store.revealedKey = nil }) { mintSheet }
            .task { await store.refresh() }
    }

    @ViewBuilder private var keyList: some View {
        if store.loading && store.keys.isEmpty {
            Spinner(label: "Loading keys…")
        } else if store.keys.isEmpty {
            EmptyState(text: "No keys yet. Tap + to mint one for the autoloop CLI.")
        } else {
            List {
                if let err = store.error {
                    ErrorNote(message: err).listRowBackground(Color.clear).listRowSeparator(.hidden)
                }
                ForEach(store.keys) { key in
                    KeyRowView(key: key) { Task { await store.revoke(id: key.id) } }
                        .listRowBackground(palette.surfaceRaised)
                        .listRowSeparatorTint(palette.borderSoft)
                }
            }
            .scrollContentBackground(.hidden)
        }
    }

    // MARK: - Mint / reveal sheet

    private var mintSheet: some View {
        NavigationStack {
            Group {
                if let secret = store.revealedKey { revealPanel(secret) }
                else { mintForm }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .appBackground(palette)
            .navigationTitle(store.revealedKey == nil ? "Mint a key" : "New key")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(store.revealedKey == nil ? "Cancel" : "Done") { showMint = false }
                }
            }
        }
    }

    private var mintForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Mint keys for the autoloop CLI; set AUTOLOOP_API_KEY.")
                .font(.footnote).foregroundStyle(palette.fgMeta)
            TextField("Label", text: $labelText)
                .textFieldStyle(.roundedBorder)
            Button {
                let label = labelText.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !label.isEmpty, !store.pending else { return }
                Task { await store.mint(label: label); labelText = "" }  // sheet switches to reveal on success
            } label: {
                Text(store.pending ? "Minting…" : "Mint").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(labelText.trimmingCharacters(in: .whitespaces).isEmpty || store.pending)
            if let err = store.error { ErrorNote(message: err) }
            Spacer()
        }
        .padding()
    }

    private func revealPanel(_ secret: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Copy it now — it won't be shown again.")
                .font(.footnote).foregroundStyle(palette.stRunning)
            Text(secret)
                .font(.system(.footnote, design: .monospaced)).foregroundStyle(palette.fg)
                .textSelection(.enabled)
                .padding().frame(maxWidth: .infinity, alignment: .leading)
                .cardSurface()
            Button { UIPasteboard.general.string = secret } label: {
                Label("Copy", systemImage: "doc.on.doc").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            Spacer()
        }
        .padding()
    }
}

private struct KeyRowView: View {
    @Environment(\.palette) private var palette
    let key: KeyMeta
    let onRevoke: () -> Void
    @State private var showConfirm = false

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(key.label).font(.body).foregroundStyle(palette.fg)
                Text("\(key.prefix)…").font(.caption.monospaced()).foregroundStyle(palette.fgSoft)
                if let ts = key.createdAt {
                    Text(Date(timeIntervalSince1970: ts), style: .date)  // createdAt decoded as epoch seconds
                        .font(.caption2).foregroundStyle(palette.fgMeta)
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
