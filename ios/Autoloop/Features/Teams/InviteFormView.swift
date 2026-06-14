import SwiftUI

/// Manager-only invite form — mirrors web InviteForm.tsx (email + role + submit).
struct InviteFormView: View {
    let onInvite: (String, Role) -> Void
    @State private var email = ""
    @State private var role: Role = .member

    var body: some View {
        HStack(spacing: 8) {
            TextField("teammate@email.com", text: $email)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.emailAddress)
            Picker("Role", selection: $role) {
                Text("member").tag(Role.member)
                Text("admin").tag(Role.admin)
                Text("owner").tag(Role.owner)
            }
            .labelsHidden()
            Button("Invite") {
                let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { onInvite(trimmed, role) }
                email = ""
            }
            .buttonStyle(.bordered).controlSize(.small)
        }
    }
}
