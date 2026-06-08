import SwiftUI

/// Mirrors LoopDetail.tsx: the expanded detail for the selected loop —
/// PlanSection (phases + tasks + lazy commits), TestRunsSection, and
/// RevisionTimeline, stacked vertically.
struct LoopDetailView: View {
    let phases: [Phase]
    let tasks: [ProjectTask]
    let testRuns: [TestRun]
    let revisions: [Revision]
    let currentTaskId: String?
    let teamId: String
    let slug: String
    let loopArg: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PlanSection(
                phases: phases,
                tasks: tasks,
                currentTaskId: currentTaskId,
                teamId: teamId,
                slug: slug,
                loopArg: loopArg
            )
            TestRunsSection(testRuns: testRuns)
            RevisionTimeline(revisions: revisions)
        }
    }
}
