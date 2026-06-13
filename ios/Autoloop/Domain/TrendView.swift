import Foundation
import CoreGraphics

/// Pure cross-loop trend logic — mirrors web trendView.ts.

/// The implicit `main` loop predates loop-level adoption and has no `order` — it always sorts
/// FIRST in a trend (oldest).
let MAIN_TREND_ORDER = -1
/// Trend fan-out cap. Older loops fall outside the window; the strip labels it ("last N loops").
let TREND_LOOPS_MAX = 20

struct TrendTaskRec { var scenarioIds: [String]? = nil }
struct TrendBugRec { var status: String? = nil }
struct TrendCommitRec { var tokensTotal: Int? = nil }

/// One loop's run data for trend derivation.
struct TrendLoopData {
    var loopId: String
    var order: Int? = nil
    var scores: [ScoreRec] = []
    var testRuns: [TestRunRec] = []
    var bugs: [TrendBugRec] = []
    var tasks: [TrendTaskRec] = []
    var taskCommits: [TrendCommitRec] = []
}

struct TrendPoint: Equatable {
    var loopId: String
    var order: Int
    var metCount: Int
    var scenarioTotal: Int        // scenarios tagged in this loop's tasks[].scenarioIds
    var avgComposite: Double?     // mean of latest composite per tagged scenario
    var bugsOpened: Int
    var bugsFixed: Int
    var tokensTotal: Int          // Σ taskCommit.tokens.total (missing ⇒ 0)
}

/// The trend window: implicit `main` first (when the project has project-direct data), then the
/// explicit loop ids — capped to the most recent TREND_LOOPS_MAX. `loopIds` must already be
/// ascending by order (the loops query orders by "order").
func trendWindowIds(_ loopIds: [String], includeMain: Bool) -> [String] {
    var combined = loopIds
    if includeMain { combined.insert(MAIN_ID, at: 0) }
    return Array(combined.suffix(TREND_LOOPS_MAX))
}

/// Per-loop trend series, ascending by order (main first). A loop is judged on what it attempted:
/// only scenarios tagged in ITS tasks count, and met-state derives from ITS loop-scoped events.
func buildTrend(_ loops: [TrendLoopData], scenarios: [ScenarioRec]) -> [TrendPoint] {
    let points = loops.map { d -> TrendPoint in
        let tagged = Set(d.tasks.flatMap { $0.scenarioIds ?? [] })
        let taggedScenarios = scenarios.filter { tagged.contains($0.id) }
        var metCount = 0
        var composites: [Double] = []
        for s in taggedScenarios {
            if deriveScenarioState(s, scores: d.scores, testRuns: d.testRuns).state == .met { metCount += 1 }
            if let latest = latestById(d.scores.filter { $0.scenarioId == s.id }), let c = latest.composite {
                composites.append(c)
            }
        }
        return TrendPoint(
            loopId: d.loopId,
            order: d.order ?? MAIN_TREND_ORDER,
            metCount: metCount,
            scenarioTotal: taggedScenarios.count,
            avgComposite: composites.isEmpty ? nil : composites.reduce(0, +) / Double(composites.count),
            bugsOpened: d.bugs.count,
            bugsFixed: d.bugs.filter { $0.status == "fixed" }.count,
            tokensTotal: d.taskCommits.reduce(0) { $0 + ($1.tokensTotal ?? 0) })
    }
    return points.sorted { a, b in
        if a.order != b.order { return a.order < b.order }
        return a.loopId < b.loopId
    }
}

/// Points for a sparkline. X advances by index across the full width; nils are skipped (the line
/// connects across the gap). A flat series renders at mid-height. Empty when nothing to plot.
func polylinePoints(_ values: [Double?], width: CGFloat, height: CGFloat, pad: CGFloat = 2) -> [CGPoint] {
    let indexed = values.enumerated().compactMap { (i, v) in v.map { (i, $0) } }
    if indexed.isEmpty { return [] }
    let lastX = CGFloat(max(values.count - 1, 1))
    let nums = indexed.map { $0.1 }
    let minV = nums.min()!
    let span = nums.max()! - minV
    return indexed.map { (i, v) in
        let x = pad + (CGFloat(i) / lastX) * (width - 2 * pad)
        let y = span == 0 ? height / 2 : pad + (1 - CGFloat((v - minV) / span)) * (height - 2 * pad)
        return CGPoint(x: x, y: y)
    }
}
