import SwiftUI

struct AppShell: View {
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject var theme: ThemeStore
    @Environment(\.palette) private var palette
    @State private var showProfile = false

    var body: some View {
        TabView {
            NavigationStack {
                DashboardView()
                    .toolbar { ToolbarItem(placement: .navigationBarTrailing) {
                        Button { showProfile = true } label: { Image(systemName: "person.crop.circle") }
                    } }
            }
            .tabItem { Label("Dashboard", systemImage: "square.grid.2x2") }

            NavigationStack { TeamsView() }
                .tabItem { Label("Teams", systemImage: "person.2") }
            NavigationStack { KeysView() }
                .tabItem { Label("Keys", systemImage: "key") }
            if auth.isAdmin {
                NavigationStack { AdminView() }
                    .tabItem { Label("Admin", systemImage: "shield") }
            }
        }
        .sheet(isPresented: $showProfile) { profileSheet }
        .onAppear { applyChrome(palette) }
        .onChange(of: theme.current.id) { _ in applyChrome(palette) }
    }

    /// Tint the nav + tab bars with the theme's deep surface so system chrome matches the board.
    private func applyChrome(_ p: Palette) {
        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = UIColor(p.surfaceDeep)
        nav.titleTextAttributes = [.foregroundColor: UIColor(p.fg)]
        nav.largeTitleTextAttributes = [.foregroundColor: UIColor(p.fg)]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav

        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = UIColor(p.surface)
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
    }

    private var profileSheet: some View {
        NavigationStack {
            List {
                Section("Signed in as") { Text(auth.user?.email ?? "—") }
                Section("Theme") {
                    ForEach(THEMES) { t in
                        Button { theme.select(t.id) } label: {
                            HStack {
                                Circle().fill(t.swatch).frame(width: 14, height: 14)
                                Text(t.label)
                                Spacer()
                                if theme.current.id == t.id { Image(systemName: "checkmark") }
                            }
                        }.foregroundStyle(.primary)
                    }
                }
                Section {
                    // Getting started is a placeholder row in SP1 (full screen later) —
                    // kept to preserve parity with the web profile menu.
                    Label("Getting started", systemImage: "questionmark.circle")
                    Button("Sign out", role: .destructive) { auth.signOut() }
                }
            }.navigationTitle("Account")
        }
    }
}
