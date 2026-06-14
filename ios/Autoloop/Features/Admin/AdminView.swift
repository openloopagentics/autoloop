import SwiftUI

/// Admin screen — the user list fills the screen; "grant access" (+) and "access requests"
/// (bell, badged when any are pending) live in the top toolbar (same pattern as Teams).
struct AdminView: View {
    @Environment(\.palette) private var palette
    @StateObject private var store = AdminStore()
    @State private var grantUid = ""
    @State private var grantEmail = ""
    @State private var showGrant = false
    @State private var showRequests = false

    private var requestCount: Int { store.requests.count }

    var body: some View {
        // AppShell already wraps this tab in a NavigationStack — don't nest another.
        userList
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .appBackground(palette)
            .navigationTitle("Admin")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { showRequests = true } label: {
                        Image(systemName: requestCount > 0 ? "bell.badge.fill" : "bell")
                    }
                    .accessibilityLabel("Access requests")
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { grantUid = ""; grantEmail = ""; showGrant = true } label: {
                        Image(systemName: "person.badge.plus")
                    }
                    .accessibilityLabel("Grant access")
                }
            }
            .sheet(isPresented: $showGrant) { grantSheet }
            .sheet(isPresented: $showRequests) { requestsSheet }
            .onAppear { Task { await store.refresh() } }
    }

    @ViewBuilder private var userList: some View {
        if store.loading && store.users.isEmpty {
            Spinner(label: "Loading…")
        } else if store.users.isEmpty {
            EmptyState(text: "No users.")
        } else {
            List {
                if let err = store.error {
                    ErrorNote(message: err).listRowBackground(Color.clear).listRowSeparator(.hidden)
                }
                ForEach(store.users) { user in
                    AdminUserRowView(user: user) { newValue in
                        Task { await store.toggle(uid: user.uid, isAllowed: newValue) }
                    }
                    .listRowBackground(palette.surfaceRaised)
                    .listRowSeparatorTint(palette.borderSoft)
                }
            }
            .scrollContentBackground(.hidden)
        }
    }

    // MARK: - Grant sheet

    private var grantSheet: some View {
        NavigationStack {
            Form {
                Section("Grant access by UID") {
                    TextField("UID", text: $grantUid)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                    TextField("Email (optional)", text: $grantEmail)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                }
            }
            .scrollContentBackground(.hidden)
            .appBackground(palette)
            .navigationTitle("Grant access")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { showGrant = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Grant") {
                        let uid = grantUid.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !uid.isEmpty else { return }
                        let email = grantEmail
                        showGrant = false
                        Task { await store.grant(uid: uid, email: email) }
                    }
                    .disabled(grantUid.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }

    // MARK: - Requests sheet

    private var requestsSheet: some View {
        NavigationStack {
            Group {
                if store.requests.isEmpty {
                    EmptyState(text: "No pending requests.")
                } else {
                    List {
                        ForEach(store.requests) { req in
                            AccessRequestRowView(request: req,
                                onApprove: { Task { await store.decide(uid: req.uid, approve: true) } },
                                onDeny:    { Task { await store.decide(uid: req.uid, approve: false) } })
                                .listRowBackground(palette.surfaceRaised)
                        }
                    }
                    .scrollContentBackground(.hidden)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .appBackground(palette)
            .navigationTitle("Access requests")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showRequests = false } } }
        }
    }
}

private struct AccessRequestRowView: View {
    @Environment(\.palette) private var palette
    let request: AccessRequest
    let onApprove: () -> Void
    let onDeny: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let email = request.email {
                Text(email).font(.body).foregroundStyle(palette.fg)
            }
            Text(request.uid).font(.caption.monospaced()).foregroundStyle(palette.fgMeta)
            if let note = request.note, !note.isEmpty {
                Text(note).font(.caption).foregroundStyle(palette.fgSoft).italic()
            }
            HStack(spacing: 8) {
                Button("Approve") { onApprove() }
                    .buttonStyle(.bordered).controlSize(.small).tint(palette.stCompleted)
                Button("Deny", role: .destructive) { onDeny() }
                    .buttonStyle(.bordered).controlSize(.small)
            }
            .padding(.top, 2)
        }
        .padding(.vertical, 2)
    }
}

private struct AdminUserRowView: View {
    @Environment(\.palette) private var palette
    let user: AdminUser
    let onToggle: (Bool) -> Void

    // Drive the toggle from the model (server truth), not local @State: on a failed
    // mutation the store doesn't refresh, so the switch snaps back instead of lying.
    private var allowedBinding: Binding<Bool> {
        Binding(get: { user.isAllowed }, set: { onToggle($0) })
    }

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(user.email ?? user.uid).font(.body).foregroundStyle(palette.fg)
                    if user.isAdmin {
                        Text("admin")
                            .font(.caption2)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(palette.accentSoft)
                            .foregroundStyle(palette.accent)
                            .clipShape(RoundedRectangle(cornerRadius: DS.radiusXs))
                    }
                }
                if user.email != nil {
                    Text(user.uid).font(.caption.monospaced()).foregroundStyle(palette.fgMeta)
                }
            }
            Spacer()
            Toggle("Allowed", isOn: allowedBinding).labelsHidden()
        }
    }
}
