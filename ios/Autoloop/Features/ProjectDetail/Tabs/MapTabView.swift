import SwiftUI

/// Mirrors MapTab.tsx: the live product-map DAG with a growth-replay scrubber and a node-detail
/// sheet. Live graph = project-wide scenario states + the selected loop's tasks/bugs; scrubbing
/// recomputes the graph as of time T over all loop slices (mapAtTime).
struct MapTabView: View {
    @ObservedObject var store: ProjectDetailStore
    @StateObject private var tabStore = MapTabStore()

    @State private var pickedNode: String?
    @State private var scrubT: Date?          // nil = live
    @State private var maxT = Date()
    @State private var playing = false

    private let tick = Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()

    // MARK: - Inputs bridged to map recs

    private var goals: [MapGoal] {
        store.goals.data.map { MapGoal(id: $0.id, title: $0.title, createdAt: $0.createdAt) }
    }
    private var scenarios: [MapScenario] {
        store.scenarios.data.map { MapScenario(id: $0.id, title: $0.title, goalId: $0.goalId,
                                               threshold: $0.threshold, createdAt: $0.createdAt) }
    }
    private var allScores: [ScoreRec] { tabStore.slices.flatMap { $0.scores } }
    private var allTestRuns: [TestRunRec] { tabStore.slices.flatMap { $0.testRuns } }
    private var productMap: String? {
        store.documents.data.first { $0.id == "product-map" }?.content
    }

    private var liveGraph: MapGraph {
        var states: [String: MapNodeState] = [:]
        for s in store.scenarios.data {
            states[s.id] = deriveScenarioState(s.asRec, scores: allScores, testRuns: allTestRuns).state == .met ? .met : .unmet
        }
        let slice = tabStore.slice(loopArg: store.loopArg)
        let tasks = slice?.tasks ?? []
        let openBugs = (slice?.bugs ?? []).filter { ($0.status ?? "open") == "open" }
        return buildMap(goals: goals, scenarios: scenarios, scenarioStates: states,
                        tasks: tasks, currentTaskId: store.selectedLoop?.currentTaskId,
                        openBugs: openBugs, productMap: productMap)
    }

    private var shownGraph: MapGraph {
        if let t = scrubT, !tabStore.slices.isEmpty {
            return mapAtTime(goals: goals, scenarios: scenarios, slices: tabStore.slices, cutoff: t)
        }
        return liveGraph
    }

    private var minT: Date { store.project?.createdAt ?? maxT.addingTimeInterval(-1) }

    var body: some View {
        Group {
            if store.goals.data.isEmpty {
                EmptyState(text: "No goals yet — the map appears once the vision has goals.")
            } else {
                let graph = shownGraph
                VStack(spacing: 8) {
                    if let warning = liveGraph.warning {
                        Text(warning).font(.caption).foregroundStyle(.orange)
                            .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.orange.opacity(0.12))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .padding(.horizontal)
                    }
                    ScrollView([.horizontal, .vertical]) {
                        MapCanvas(nodes: graph.nodes, edges: graph.edges,
                                  onTap: scrubT == nil ? { pickedNode = $0 } : nil)
                            .padding()
                    }
                    if !tabStore.slices.isEmpty { scrubber }
                }
            }
        }
        .onAppear {
            maxT = Date()
            tabStore.update(teamId: store.teamId, slug: store.slug,
                            loops: store.loops.data, includeMain: store.hasProjectDirectData)
        }
        .onChange(of: store.loops.data.map(\.id)) { _ in
            tabStore.update(teamId: store.teamId, slug: store.slug,
                            loops: store.loops.data, includeMain: store.hasProjectDirectData)
        }
        .onDisappear { tabStore.stop() }
        .onReceive(tick) { _ in advancePlayback() }
        .sheet(item: Binding(get: { pickedNode.map { NodeID(id: $0) } },
                             set: { pickedNode = $0?.id })) { picked in
            MapDetailSheet(nodeId: picked.id, scenarios: store.scenarios.data, goals: store.goals.data,
                           scores: allScores, testRuns: allTestRuns, nodes: liveGraph.nodes,
                           selectedSlice: tabStore.slice(loopArg: store.loopArg))
        }
    }

    // MARK: - Scrubber

    private var scrubber: some View {
        HStack(spacing: 12) {
            Button { togglePlay() } label: {
                Image(systemName: playing ? "pause.fill" : "play.fill")
            }
            Slider(value: Binding(
                get: { (scrubT ?? maxT).timeIntervalSince1970 },
                set: { v in
                    playing = false
                    scrubT = v >= maxT.timeIntervalSince1970 ? nil : Date(timeIntervalSince1970: v)
                }),
                in: minT.timeIntervalSince1970...maxT.timeIntervalSince1970)
            Text(scrubT == nil ? "Live" : shortDate(scrubT!))
                .font(.caption.monospacedDigit())
                .foregroundStyle(scrubT == nil ? Color.green : .secondary)
                .frame(width: 64, alignment: .trailing)
        }
        .padding(.horizontal)
        .padding(.bottom, 8)
    }

    private func togglePlay() {
        if !playing && scrubT == nil { scrubT = minT }
        playing.toggle()
    }

    /// ~10s sweep (100 ticks); reaching max ⇒ back to live.
    private func advancePlayback() {
        guard playing else { return }
        let step = maxT.timeIntervalSince(minT) / 100
        let next = (scrubT ?? minT).addingTimeInterval(step)
        if next >= maxT { playing = false; scrubT = nil }
        else { scrubT = next }
    }

    private func shortDate(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "MMM d"; return f.string(from: d)
    }
}

private struct NodeID: Identifiable { let id: String }

/// Detail for a tapped node — scenario card (with verification-less scores), task, bug, goal, or component.
private struct MapDetailSheet: View {
    let nodeId: String
    let scenarios: [Scenario]
    let goals: [Goal]
    let scores: [ScoreRec]
    let testRuns: [TestRunRec]
    let nodes: [MapNode]
    let selectedSlice: MapSlice?

    @Environment(\.dismiss) private var dismiss

    private var ns: String { String(nodeId.prefix(while: { $0 != ":" })) }
    private var key: String { String(nodeId.drop(while: { $0 != ":" }).dropFirst()) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    switch ns {
                    case "g":
                        if let g = goals.first(where: { $0.id == key }) {
                            Text(g.title ?? g.id).font(.title3.bold())
                            if let d = g.description { Text(d).foregroundStyle(.secondary) }
                        }
                    case "s":
                        if let s = scenarios.first(where: { $0.id == key }) {
                            // ScenarioCard needs full Score/TestRun; the map carries recs only, so
                            // show a compact summary derived from those recs.
                            scenarioSummary(s)
                        }
                    case "t":
                        if let t = selectedSlice?.tasks.first(where: { $0.id == key }) {
                            Text(t.title ?? t.id).font(.title3.bold())
                            if let st = t.status { StatusBadge(status: st) }
                        }
                    case "b":
                        if let b = selectedSlice?.bugs.first(where: { $0.id == key }) {
                            Text(b.title ?? b.id).font(.title3.bold())
                            if let sev = b.severity { Text("severity: \(sev)").foregroundStyle(.secondary) }
                        }
                    case "c":
                        if let n = nodes.first(where: { $0.id == nodeId }) {
                            Text(n.label).font(.title3.bold())
                            Text("component").foregroundStyle(.secondary)
                        }
                    default: EmptyView()
                    }
                    Spacer()
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }

    @ViewBuilder private func scenarioSummary(_ s: Scenario) -> some View {
        let state = deriveScenarioState(s.asRec, scores: scores, testRuns: testRuns)
        Text(s.title ?? s.id).font(.title3.bold())
        if let desc = s.description { Text(desc).foregroundStyle(.secondary) }
        Text(state.state == .met ? "met" : "unmet")
            .font(.caption).padding(.horizontal, 8).padding(.vertical, 2)
            .background((state.state == .met ? Color.green : Color.orange).opacity(0.15))
            .foregroundStyle(state.state == .met ? Color.green : Color.orange)
            .clipShape(Capsule())
        if let c = state.latestComposite {
            Text("composite \(String(format: "%.0f", c)) / threshold \(s.threshold ?? DEFAULT_THRESHOLD)")
                .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        }
    }
}
