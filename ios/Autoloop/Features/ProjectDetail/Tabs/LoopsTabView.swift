import SwiftUI

/// Mirrors LoopsTab.tsx / LoopList.tsx: a list of loop rows; tapping one
/// selects it and expands LoopDetailView inline beneath it.
///
/// Subscription strategy (b) — lighter: only the SELECTED loop has live
/// phases/scores/testRuns/revisions listeners (owned by `LoopsTabStore`),
/// re-subscribed on `store.loopArg` change. Non-selected rows render light
/// (name/status only, no progress/met) to cap concurrent listeners on mobile.
struct LoopsTabView: View {
    @ObservedObject var store: ProjectDetailStore
    @StateObject private var tabStore = LoopsTabStore()

    private var loops: [SelectableLoop] { store.loopList }
    private var groups: [LoopGroup] { groupLoopRuns(loops) }

    private var selectedProgress: (done: Int, total: Int) {
        phaseProgress(tabStore.phases.data.map(\.asPhaseRec))
    }

    private var selectedMet: (met: Int, total: Int) {
        summarize(store.scenarios.data.map(\.asRec),
                  scores: tabStore.scores.data.map(\.asRec),
                  testRuns: tabStore.testRuns.data.map(\.asRec))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if loops.isEmpty {
                    if store.loops.loading && store.loops.data.isEmpty {
                        HStack { Spacer(); Spinner(); Spacer() }.padding()
                    } else {
                        EmptyState(text: "No loops yet.")
                    }
                } else {
                    ForEach(groups, id: \.label) { group in
                        Text(groupLabel(group.label))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .textCase(.uppercase)
                            .padding(.horizontal)
                            .padding(.top, 4)
                        ForEach(group.loops, id: \.id) { loop in
                            let isSelected = loop.id == store.resolvedSelectedId
                            VStack(alignment: .leading, spacing: 12) {
                                LoopRow(
                                    loop: loop,
                                    selected: isSelected,
                                    progress: isSelected ? selectedProgress : nil,
                                    met: isSelected ? selectedMet : nil,
                                    onSelect: { store.selectedId = loop.id }
                                )
                                if isSelected {
                                    detailView
                                }
                            }
                            .padding(.horizontal)
                        }
                    }
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

    private func groupLabel(_ key: String) -> String {
        switch key {
        case "legacy": return "Legacy"
        case "earlier": return "Earlier"
        default: return key
        }
    }

    @ViewBuilder private var detailView: some View {
        if tabStore.phases.loading && tabStore.phases.data.isEmpty
            && tabStore.tasks.loading && tabStore.tasks.data.isEmpty {
            HStack { Spacer(); Spinner(); Spacer() }.padding()
        } else {
            LoopDetailView(
                phases: tabStore.phases.data,
                tasks: tabStore.tasks.data,
                testRuns: tabStore.testRuns.data,
                revisions: tabStore.revisions.data,
                currentTaskId: store.selectedLoop?.currentTaskId,
                teamId: store.teamId,
                slug: store.slug,
                loopArg: store.loopArg
            )
        }
    }
}
