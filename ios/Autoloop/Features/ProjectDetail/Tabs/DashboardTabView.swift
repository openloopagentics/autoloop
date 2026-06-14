import SwiftUI

struct DashboardTabView: View {
    @ObservedObject var store: ProjectDetailStore
    @StateObject private var tabStore = DashboardTabStore()
    @StateObject private var trendStore = TrendStore()

    private var trendPoints: [TrendPoint] {
        buildTrend(trendStore.loopData, scenarios: store.scenarios.data.map(\.asRec))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                RollupStrip(loops: store.loopList, status: store.effectiveStatus)

                TrendsStrip(points: trendPoints)

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
            trendStore.update(teamId: store.teamId, slug: store.slug,
                              loops: store.loops.data, includeMain: store.hasProjectDirectData)
        }
        .onChange(of: store.loopArg) { arg in
            tabStore.subscribe(teamId: store.teamId, slug: store.slug, loopArg: arg)
        }
        .onChange(of: store.loops.data.map(\.id)) { _ in
            trendStore.update(teamId: store.teamId, slug: store.slug,
                              loops: store.loops.data, includeMain: store.hasProjectDirectData)
        }
        .onDisappear {
            tabStore.stop()
            trendStore.stop()
        }
    }
}
