import SwiftUI

/// Mirrors PlanSection.tsx: phases ordered, each with its tasks (current task
/// highlighted). When tasks exist we render the task-grouped layout; otherwise
/// we fall back to a legacy phase list. Commits load lazily per task/phase via
/// DisclosureGroup (CommitsStore).
struct PlanSection: View {
    let phases: [Phase]
    let tasks: [ProjectTask]
    let currentTaskId: String?
    let teamId: String
    let slug: String
    let loopArg: String?

    private func tasksFor(_ phaseId: String) -> [ProjectTask] {
        tasks.filter { $0.phaseId == phaseId }
    }

    /// Phases that have at least one task; fall back to synthetic phases keyed
    /// by the task phaseIds so tasks stay visible before phase docs load.
    private var visiblePhases: [Phase] {
        if !phases.isEmpty { return phases }
        let ids = Array(Set(tasks.compactMap { $0.phaseId })).sorted()
        return ids.map { Phase(id: $0, name: $0) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if tasks.isEmpty {
                Text("Phases")
                    .font(.title3.bold())
                    .padding(.horizontal)
                if phases.isEmpty {
                    EmptyState(text: "No phases yet.")
                        .frame(height: 60)
                } else {
                    ForEach(phases, id: \.id) { phase in
                        LegacyPhaseItem(phase: phase, teamId: teamId, slug: slug, loopArg: loopArg)
                            .padding(.horizontal)
                    }
                }
            } else {
                Text("Tasks")
                    .font(.title3.bold())
                    .padding(.horizontal)
                ForEach(visiblePhases, id: \.id) { phase in
                    PlanPhaseBlock(
                        phase: phase,
                        tasks: tasksFor(phase.id),
                        currentTaskId: currentTaskId,
                        teamId: teamId,
                        slug: slug,
                        loopArg: loopArg
                    )
                    .padding(.horizontal)
                }
            }
        }
    }
}

/// One phase card containing its task rows.
private struct PlanPhaseBlock: View {
    let phase: Phase
    let tasks: [ProjectTask]
    let currentTaskId: String?
    let teamId: String
    let slug: String
    let loopArg: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(phase.name ?? phase.id)
                .font(.headline)
            ForEach(tasks, id: \.id) { task in
                TaskItem(
                    task: task,
                    isCurrent: task.id == currentTaskId,
                    teamId: teamId,
                    slug: slug,
                    loopArg: loopArg
                )
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

/// Mirrors TaskItem.tsx: task title + status, scenario ids, lazy commits.
struct TaskItem: View {
    let task: ProjectTask
    let isCurrent: Bool
    let teamId: String
    let slug: String
    let loopArg: String?

    @StateObject private var commitsStore = CommitsStore()

    var body: some View {
        DisclosureGroup {
            commitList
        } label: {
            HStack(spacing: 6) {
                if isCurrent {
                    Circle().fill(Color.green).frame(width: 8, height: 8)
                }
                Text(task.title ?? task.id)
                    .font(.subheadline)
                if let status = task.status {
                    StatusBadge(status: status)
                }
                if let scns = task.scenarioIds, !scns.isEmpty {
                    Text(scns.joined(separator: ", "))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
            }
        }
        .onAppear {
            commitsStore.startTask(teamId: teamId, slug: slug, taskId: task.id, loopArg: loopArg)
        }
    }

    @ViewBuilder private var commitList: some View {
        let commits = commitsStore.commits.data
        if commits.isEmpty {
            Text("No commits yet")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.vertical, 4)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(commits, id: \.id) { CommitItem(commit: $0) }
            }
            .padding(.top, 4)
        }
    }
}

/// Mirrors PhaseItem.tsx: legacy phase row with status + lazy commits.
struct LegacyPhaseItem: View {
    let phase: Phase
    let teamId: String
    let slug: String
    let loopArg: String?

    @StateObject private var commitsStore = CommitsStore()

    var body: some View {
        DisclosureGroup {
            commitList
        } label: {
            HStack(spacing: 6) {
                if phase.status == "running" {
                    Circle().fill(Color.green).frame(width: 8, height: 8)
                }
                Text(phase.name ?? phase.id)
                    .font(.subheadline)
                if let status = phase.status {
                    StatusBadge(status: status)
                }
                Spacer()
            }
        }
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .onAppear {
            commitsStore.startPhase(teamId: teamId, slug: slug, phaseId: phase.id, loopArg: loopArg)
        }
    }

    @ViewBuilder private var commitList: some View {
        let commits = commitsStore.commits.data
        if commits.isEmpty {
            Text("No commits yet")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.vertical, 4)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(commits, id: \.id) { CommitItem(commit: $0) }
            }
            .padding(.top, 4)
        }
    }
}

/// Mirrors CommitItem.tsx: short sha, message, author, token total.
struct CommitItem: View {
    let commit: Commit

    private func fmt(_ n: Int) -> String {
        if n >= 1_000_000 { return String(format: "%.1fM", Double(n) / 1_000_000) }
        if n >= 1_000 { return String(format: "%.1fk", Double(n) / 1_000) }
        return String(n)
    }

    private var shortSha: String { String(commit.id.prefix(7)) }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text(shortSha)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                if let msg = commit.message {
                    Text(msg)
                        .font(.caption.monospaced())
                        .lineLimit(2)
                }
                HStack(spacing: 8) {
                    if let author = commit.author {
                        Text(author).font(.caption2).foregroundStyle(.secondary)
                    }
                    if let t = commit.tokens {
                        Text("\(fmt(t.total)) tok")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }
            Spacer()
        }
    }
}
