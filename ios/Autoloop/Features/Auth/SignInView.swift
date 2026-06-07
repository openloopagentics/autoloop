import SwiftUI

struct SignInView: View {
    @EnvironmentObject var auth: AuthStore
    var body: some View {
        VStack(spacing: 16) {
            Text("autoloop").font(.largeTitle.bold())
            Button("Sign in with Google") { Task { await auth.signIn() } }
                .buttonStyle(.borderedProminent)
            if let err = auth.signInError { Text(err).foregroundStyle(.red).font(.footnote) }
        }.padding()
    }
}
