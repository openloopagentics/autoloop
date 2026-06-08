import SwiftUI

/// Mirrors TestsTab.tsx: groups test runs by scenario (tested vision scenarios,
/// then extra ids only in runs, then untested vision scenarios). Each group is
/// a disclosure row showing a pass/fail/none badge; expanding shows run history
/// (latest first) with summary + issues.
struct TestsTabView: View {
    @ObservedObject var store: ProjectDetailStore
    @StateObject private var tabStore = TestsTabStore()

    private var scenarios: [Scenario] { store.scenarios.data }
    private var allTestRuns: [TestRun] { tabStore.allTestRuns.data }
    private var loopIds: [String] { store.loops.data.map(\.id) }

    private var groups: [TestGroup] {
        buildTestGroups(scenarios: scenarios, runs: allTestRuns)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if scenarios.isEmpty && allTestRuns.isEmpty {
                    if store.scenarios.loading && tabStore.allTestRuns.loading {
                        HStack { Spacer(); Spinner(); Spacer() }.padding()
                    } else {
                        EmptyState(text: "No tests yet — they appear as the loop verifies each scenario.")
                    }
                } else {
                    Text("Tests")
                        .font(.title3.bold())
                        .padding(.horizontal)
                    ForEach(groups, id: \.scenarioId) { group in
                        TestGroupRow(group: group)
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

/// A single scenario's test group: disclosure header with badge, expanded
/// run history (latest first).
private struct TestGroupRow: View {
    let group: TestGroup

    private var sortedRuns: [TestRun] {
        group.runs.sorted { $0.id > $1.id }  // latest first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if group.runs.isEmpty {
                header(expandable: false)
            } else {
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(sortedRuns, id: \.id) { run in
                            runItem(run)
                        }
                    }
                    .padding(.top, 8)
                } label: {
                    header(expandable: true)
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func header(expandable: Bool) -> some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(group.title)
                    .font(.subheadline.bold())
                Text(group.scenarioId)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if group.runs.count > 1 {
                Text("\(group.runs.count) runs")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            badge
        }
    }

    @ViewBuilder private var badge: some View {
        if let latest = group.latest {
            let p = latest.passed ?? 0
            let f = latest.failed ?? 0
            let passing = group.state == .pass
            Text("\(p)/\(p + f) \(passing ? "✓" : "✗")")
                .font(.caption.monospacedDigit())
                .padding(.horizontal, 8).padding(.vertical, 2)
                .background((passing ? Color.green : Color.red).opacity(0.15))
                .foregroundStyle(passing ? Color.green : Color.red)
                .clipShape(Capsule())
        } else {
            Text("no test")
                .font(.caption)
                .padding(.horizontal, 8).padding(.vertical, 2)
                .background(Color.gray.opacity(0.15))
                .foregroundStyle(.secondary)
                .clipShape(Capsule())
        }
    }

    private func runItem(_ run: TestRun) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text("\(run.passed ?? 0) passed · \(run.failed ?? 0) failed")
                    .font(.caption.monospacedDigit())
                if let loopId = run.loopId {
                    Text(loopId).font(.caption2).foregroundStyle(.secondary)
                }
                if let taskId = run.taskId {
                    Text("task \(taskId)").font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
            }
            if let summary = run.summary, !summary.isEmpty {
                Text(summary)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
            if let issues = run.issues, !issues.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(issues.enumerated()), id: \.offset) { _, iss in
                        Text(iss)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}
