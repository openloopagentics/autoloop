import SwiftUI

/// Mirrors ScenarioCard.tsx (and ScenarioRow from ScenarioTable.tsx):
/// shows scenario title, description, composite score bar with threshold
/// marker, latest test result, and an optional score-history disclosure.
struct ScenarioCard: View {
    let scenario: Scenario
    let scores: [Score]
    let testRuns: [TestRun]
    /// Independent-verification evidence (loop-scoped). Empty → no badge.
    var verifications: [Verification] = []

    private var state: ScenarioState {
        deriveScenarioState(scenario.asRec,
                            scores: scores.map(\.asRec),
                            testRuns: testRuns.map(\.asRec))
    }

    /// Verdict for the scenario's LATEST test run (older runs ignored) — annotation, not a gate.
    private var verdict: String? {
        scenarioVerification(scenario.id, latestTestRunId: state.latestTest?.id, verifications.map(\.asRec))
    }

    private var threshold: Int { scenario.threshold ?? DEFAULT_THRESHOLD }

    private var compositePct: Double {
        min(100, max(0, state.latestComposite ?? 0))
    }

    /// All scores for this scenario, sorted oldest-first (ULID id == time order).
    private var history: [Score] {
        scores
            .filter { $0.scenarioId == scenario.id }
            .sorted { $0.id < $1.id }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header
            HStack {
                Text(scenario.title ?? scenario.id)
                    .font(.subheadline.bold())
                Spacer()
                if let v = verdict { verificationBadge(v) }
                stateChip
            }

            // Description
            if let desc = scenario.description {
                Text(desc)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            // Score bar
            scoreBarView

            // Latest test
            testSummaryView

            // Score history disclosure (only when there are multiple entries)
            if history.count > 1 {
                DisclosureGroup("Score history (\(history.count))") {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(history, id: \.id) { s in
                            Text(s.composite.map { String(format: "%.1f", $0) } ?? "—")
                                .font(.caption.monospacedDigit())
                        }
                    }
                    .padding(.top, 4)
                }
                .font(.caption)
            }
        }
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    // MARK: - Sub-views

    /// ✓ Verified (confirmed) / ✗ Refuted — evidence on the latest test run.
    private func verificationBadge(_ verdict: String) -> some View {
        let confirmed = verdict == "confirmed"
        return Label(confirmed ? "Verified" : "Refuted", systemImage: confirmed ? "checkmark.seal.fill" : "xmark.seal.fill")
            .font(.caption2)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background((confirmed ? Color.green : Color.red).opacity(0.15))
            .foregroundStyle(confirmed ? Color.green : Color.red)
            .clipShape(Capsule())
    }

    private var stateChip: some View {
        let isMet = state.state == .met
        return Text(isMet ? "met" : "unmet")
            .font(.caption)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(isMet ? Color.green.opacity(0.15) : Color.orange.opacity(0.15))
            .foregroundStyle(isMet ? Color.green : Color.orange)
            .clipShape(Capsule())
    }

    private var scoreBarView: some View {
        HStack(spacing: 8) {
            // Track
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Color(.systemGray5))
                        .frame(height: 8)
                    // Fill
                    Capsule()
                        .fill(state.state == .met ? Color.green : Color.orange)
                        .frame(width: geo.size.width * CGFloat(compositePct) / 100, height: 8)
                    // Threshold marker
                    Rectangle()
                        .fill(Color.primary.opacity(0.5))
                        .frame(width: 2, height: 12)
                        .offset(x: geo.size.width * CGFloat(threshold) / 100 - 1)
                }
            }
            .frame(height: 12)

            // Numeric value
            Text(state.latestComposite.map { String(format: "%.0f", $0) } ?? "—")
                .font(.caption.monospacedDigit())
                .frame(minWidth: 28, alignment: .trailing)
        }
    }

    private var testSummaryView: some View {
        Group {
            if let runRec = state.latestTest,
               let run = testRuns.first(where: { $0.id == runRec.id }) {
                let p = run.passed ?? 0
                let f = run.failed ?? 0
                Text("tests: \(p) passed, \(f) failed")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else if state.latestTest != nil {
                // rec found but full model not yet — show failed count only
                let f = state.latestTest?.failed ?? 0
                Text("tests: \(f) failed")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Text("no test run yet")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
