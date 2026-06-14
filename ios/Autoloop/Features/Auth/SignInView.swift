import SwiftUI

struct SignInView: View {
    @EnvironmentObject var auth: AuthStore
    @Environment(\.palette) private var palette
    var body: some View {
        VStack(spacing: 18) {
            Text("autoloop")
                .font(.serif(40, .semibold))
                .foregroundStyle(palette.fg)
            Text("live status board for AI coding agents")
                .font(.system(size: 13))
                .foregroundStyle(palette.fgMeta)
            Button("Sign in with Google") { Task { await auth.signIn() } }
                .buttonStyle(.borderedProminent)
                .padding(.top, 4)
            if let err = auth.signInError {
                Text(err).foregroundStyle(palette.stFailed).font(.footnote)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .appBackground(palette)
    }
}
