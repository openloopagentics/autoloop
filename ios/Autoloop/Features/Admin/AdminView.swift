import SwiftUI

struct AdminView: View {
    @StateObject private var store = AdminStore()
    @State private var grantUid = ""
    @State private var grantEmail = ""

    var body: some View {
        // AppShell already wraps this tab in a NavigationStack — don't nest another.
        List {
                // Error
                if let err = store.error {
                    Section { ErrorNote(message: err) }
                }

                // Loading spinner (first load only)
                if store.loading && store.users.isEmpty && store.requests.isEmpty {
                    Section { Spinner(label: "Loading…") }
                }

                // Grant by UID
                Section("Grant access by UID") {
                    TextField("UID", text: $grantUid)
                        .textFieldStyle(.roundedBorder)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                    TextField("Email (optional)", text: $grantEmail)
                        .textFieldStyle(.roundedBorder)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                    Button("Grant") {
                        let uid = grantUid.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !uid.isEmpty else { return }
                        let email = grantEmail
                        grantUid = ""
                        grantEmail = ""
                        Task { await store.grant(uid: uid, email: email) }
                    }
                    .buttonStyle(.bordered)
                    .disabled(grantUid.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }

                // Access requests
                Section("Access requests") {
                    if store.requests.isEmpty {
                        Text("No pending requests.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(store.requests) { req in
                            AccessRequestRowView(request: req,
                                onApprove: { Task { await store.decide(uid: req.uid, approve: true) } },
                                onDeny:    { Task { await store.decide(uid: req.uid, approve: false) } })
                        }
                    }
                }

                // All users
                Section("All users") {
                    if store.users.isEmpty && !store.loading {
                        Text("No users.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(store.users) { user in
                            AdminUserRowView(user: user) { newValue in
                                Task { await store.toggle(uid: user.uid, isAllowed: newValue) }
                            }
                        }
                    }
                }
        }
        .navigationTitle("Admin")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { Task { await store.refresh() } }
    }
}

private struct AccessRequestRowView: View {
    let request: AccessRequest
    let onApprove: () -> Void
    let onDeny: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let email = request.email {
                Text(email).font(.body)
            }
            Text(request.uid)
                .font(.caption)
                .foregroundStyle(.secondary)
            if let note = request.note, !note.isEmpty {
                Text(note)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .italic()
            }
            Text("Status: \(request.status)")
                .font(.caption2)
                .foregroundStyle(.tertiary)
            HStack(spacing: 8) {
                Button("Approve") { onApprove() }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .tint(.green)
                Button("Deny", role: .destructive) { onDeny() }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
            .padding(.top, 2)
        }
        .padding(.vertical, 2)
    }
}

private struct AdminUserRowView: View {
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
                    Text(user.email ?? user.uid).font(.body)
                    if user.isAdmin {
                        Text("admin")
                            .font(.caption2)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(Color.accentColor.opacity(0.15))
                            .cornerRadius(4)
                    }
                }
                if user.email != nil {
                    Text(user.uid)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Toggle("Allowed", isOn: allowedBinding)
                .labelsHidden()
        }
    }
}
