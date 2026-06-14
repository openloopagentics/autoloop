import SwiftUI

struct RootView: View {
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject var theme: ThemeStore

    var body: some View {
        content
            .tint(theme.palette.accent)                  // gold/theme accent across controls
            .environment(\.palette, theme.palette)       // design tokens for every descendant
            .preferredColorScheme(theme.colorScheme)     // system chrome matches the theme
    }

    @ViewBuilder private var content: some View {
        switch auth.state {
        case .loading:   Spinner()
        case .signedOut: SignInView()
        case .pending:   RequestAccessView()
        case .allowed:   AppShell()
        }
    }
}
