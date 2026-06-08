import Foundation

// MARK: - Loop → LoopRec / StatusLoop

extension Loop {
    var asLoopRec: LoopRec {
        LoopRec(id: id, goal: goal, name: name, status: status, order: order,
                currentPhaseId: currentPhaseId, currentTaskId: currentTaskId)
    }
    var asStatusLoop: StatusLoop {
        StatusLoop(id: id, status: status, order: order)
    }
}

// MARK: - Project → ProjectRec

extension Project {
    var asProjectRec: ProjectRec {
        ProjectRec(slug: slug, status: status,
                   currentPhaseId: currentPhaseId, currentTaskId: currentTaskId)
    }
}

// MARK: - Phase → PhaseRec

extension Phase {
    var asPhaseRec: PhaseRec {
        PhaseRec(status: status)
    }
}

// MARK: - Scenario / Score / TestRun → …Rec

extension Scenario {
    var asRec: ScenarioRec {
        ScenarioRec(id: id, threshold: threshold)
    }
}

extension Score {
    var asRec: ScoreRec {
        ScoreRec(id: id, scenarioId: scenarioId, composite: composite)
    }
}

extension TestRun {
    var asRec: TestRunRec {
        TestRunRec(id: id, scenarioId: scenarioId, failed: failed)
    }
}
