import SwiftUI

struct ProjectDetailView: View {
    let teamId: String
    let slug: String
    @Environment(\.palette) private var palette
    @StateObject private var store: ProjectDetailStore
    @State private var tab: ProjectDetailTab = .dashboard

    init(teamId: String, slug: String) {
        self.teamId = teamId; self.slug = slug
        _store = StateObject(wrappedValue: ProjectDetailStore(teamId: teamId, slug: slug))
    }

    var body: some View {
        VStack(spacing: 0) {
            if store.project == nil && !store.notFound {
                Spinner()
            } else if store.notFound {
                EmptyState(text: "Project not found.")
            } else {
                ProjectHeaderView(project: store.project!, status: store.effectiveStatus)
                TabStrip(selection: $tab)
                TabView(selection: $tab) {
                    DashboardTabView(store: store).tag(ProjectDetailTab.dashboard)
                    VisionTabView(store: store).tag(ProjectDetailTab.vision)
                    LoopsTabView(store: store).tag(ProjectDetailTab.loops)
                    TestsTabView(store: store).tag(ProjectDetailTab.tests)
                    BugsTabView(store: store).tag(ProjectDetailTab.bugs)
                    MapTabView(store: store).tag(ProjectDetailTab.map)
                    IdeasTabView(store: store).tag(ProjectDetailTab.ideas)
                    MessagesTabView(store: store).tag(ProjectDetailTab.messages)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .appBackground(palette)
        .navigationTitle(store.project?.title ?? slug)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { store.start() }
        .onDisappear { store.stop() }
    }
}
