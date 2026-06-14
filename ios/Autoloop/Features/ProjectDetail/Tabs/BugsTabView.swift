import SwiftUI

/// Mirrors BugsTab.tsx / BugsList.tsx: open bugs first, then fixed.
struct BugsTabView: View {
    @ObservedObject var store: ProjectDetailStore
    @StateObject private var tabStore = BugsTabStore()

    private var bugs: [Bug] { tabStore.allBugs.data }
    private var loopIds: [String] { store.loops.data.map(\.id) }

    /// open (status != "fixed") first, then fixed — mirrors BugsList.tsx.
    private var ordered: [Bug] {
        let open = bugs.filter { $0.status != "fixed" }
        let fixed = bugs.filter { $0.status == "fixed" }
        return open + fixed
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if ordered.isEmpty {
                    if tabStore.allBugs.loading && bugs.isEmpty {
                        HStack { Spacer(); Spinner(); Spacer() }.padding()
                    } else {
                        EmptyState(text: "No bugs reported.")
                    }
                } else {
                    Text("Bugs")
                        .font(.title3.bold())
                        .padding(.horizontal)
                    ForEach(ordered, id: \.id) { bug in
                        BugRow(bug: bug)
                            .padding(.horizontal)
                    }
                }
            }
            .padding(.vertical)
        }
        .onAppear {
            tabStore.subscribe(teamId: store.teamId, slug: store.slug, loopIds: loopIds)
        }
        .onChange(of: store.loops.data.map(\.id)) { ids in
            tabStore.subscribe(teamId: store.teamId, slug: store.slug, loopIds: ids)
        }
        .onDisappear {
            tabStore.stop()
        }
    }
}
