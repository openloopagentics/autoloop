import SwiftUI

struct RequestAccessView: View {
    @EnvironmentObject var auth: AuthStore
    var body: some View {
        VStack(spacing: 16) {
            Text("Access pending").font(.title2.bold())
            Text("Your account (\(auth.user?.email ?? "")) isn’t on the allowlist yet.")
                .multilineTextAlignment(.center).foregroundStyle(.secondary)
            Button("Sign out") { auth.signOut() }
        }.padding()
    }
}
