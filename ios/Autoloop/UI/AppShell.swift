import SwiftUI

struct AppShell: View {
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject var theme: ThemeStore
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
