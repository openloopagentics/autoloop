import SwiftUI

struct VisionTabView: View {
    @ObservedObject var store: ProjectDetailStore
    @StateObject private var tabStore = VisionTabStore()

    // Convenience accessors
    private var scenarios: [Scenario] { store.scenarios.data }
    private var goals: [Goal]         { store.goals.data }
    private var documents: [DocumentRec] { store.documents.data }
    private var allScores: [Score]    { tabStore.allScores.data }
    private var allTestRuns: [TestRun] { tabStore.allTestRuns.data }

    private var loopIds: [String] { store.loops.data.map(\.id) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Scenarios met banner (all-scope)
                if !scenarios.isEmpty {
                    let stats = summarize(scenarios.map(\.asRec),
                                         scores: allScores.map(\.asRec),
                                         testRuns: allTestRuns.map(\.asRec))
                    ScenariosMetBanner(met: stats.met, total: stats.total)
                }

                // Vision section: goals + scenarios (read-only, SP3 adds editing)
                if !scenarios.isEmpty {
                    visionSection
                }

                // Documents section
                if !documents.isEmpty {
                    documentsSection
                }

                // Empty state when nothing is loaded yet
                if scenarios.isEmpty && documents.isEmpty {
                    if store.scenarios.loading || store.documents.loading {
                        HStack { Spacer(); Spinner(); Spacer() }
                            .padding()
                    } else {
                        EmptyState(text: "No vision content yet")
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

    // MARK: - Vision section

    private var visionSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Vision")
                .font(.title3.bold())
                .padding(.horizontal)

            // Goals that have scenarios
            ForEach(goals, id: \.id) { goal in
                let items = scenarios.filter { $0.goalId == goal.id }
                if !items.isEmpty {
                    goalBlock(goal: goal, items: items)
                }
            }

            // Ungrouped scenarios (goalId matches no known goal)
            let goalIds = Set(goals.map(\.id))
            let orphaned = scenarios.filter { s in
                guard let gid = s.goalId else { return true }
                return !goalIds.contains(gid)
            }
            if !orphaned.isEmpty {
                ungroupedBlock(items: orphaned)
            }
        }
    }

    private func goalBlock(goal: Goal, items: [Scenario]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(goal.title ?? goal.id)
                    .font(.headline)
                    .padding(.horizontal)
                if let desc = goal.description {
                    Text(desc)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal)
                }
            }
            ForEach(items, id: \.id) { scenario in
                ScenarioCard(scenario: scenario,
                             scores: allScores,
                             testRuns: allTestRuns)
                    .padding(.horizontal)
            }
        }
    }

    private func ungroupedBlock(items: [Scenario]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Ungrouped")
                .font(.headline)
                .foregroundStyle(.secondary)
                .padding(.horizontal)
            ForEach(items, id: \.id) { scenario in
                ScenarioCard(scenario: scenario,
                             scores: allScores,
                             testRuns: allTestRuns)
                    .padding(.horizontal)
            }
        }
    }

    // MARK: - Documents section

    private var documentsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Documents")
                .font(.title3.bold())
                .padding(.horizontal)
            ForEach(documents, id: \.id) { doc in
                DocumentRow(document: doc)
                    .padding(.horizontal)
            }
        }
    }
}
