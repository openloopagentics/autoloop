import SwiftUI

struct DashboardTabView: View {
    @ObservedObject var store: ProjectDetailStore
    @StateObject private var tabStore = DashboardTabStore()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                RollupStrip(loops: store.loopList, status: store.effectiveStatus)

                if let loop = store.selectedLoop {
                    // Show spinner only on first load (empty + loading), not on loop switch
                    if tabStore.phases.loading && tabStore.phases.data.isEmpty {
                        HStack { Spacer(); Spinner(); Spacer() }
                            .padding()
                    } else {
                        LoopSnapshot(
                            loop: loop,
                            phases: tabStore.phases.data,
                            tasks: tabStore.tasks.data,
                            scenarios: store.scenarios.data,
                            scores: tabStore.scores.data,
                            testRuns: tabStore.testRuns.data
                        )
                    }
                } else if store.loops.loading && store.loops.data.isEmpty {
                    HStack { Spacer(); Spinner(); Spacer() }
                        .padding()
                } else if store.loopList.isEmpty {
                    EmptyState(text: "No loops yet")
                }
            }
            .padding(.vertical)
        }
        .onAppear {
            tabStore.subscribe(teamId: store.teamId, slug: store.slug, loopArg: store.loopArg)
        }
        .onChange(of: store.loopArg) { arg in
            tabStore.subscribe(teamId: store.teamId, slug: store.slug, loopArg: arg)
        }
        .onDisappear {
            tabStore.stop()
        }
    }
}
