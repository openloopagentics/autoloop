import SwiftUI

struct RootView: View {
    @EnvironmentObject var auth: AuthStore
    var body: some View {
        switch auth.state {
        case .loading:   Spinner()
        case .signedOut: SignInView()
        case .pending:   RequestAccessView()
        case .allowed:   AppShell()
        }
    }
}
