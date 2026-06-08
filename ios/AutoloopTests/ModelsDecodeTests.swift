import XCTest
@testable import Autoloop

final class ModelsDecodeTests: XCTestCase {
    func testProjectFromFirestoreDict() {
        let doc: [String: Any] = ["title": "Demo", "status": "running", "extra": 42]
        let p = Project(slug: "demo", data: doc)
        XCTAssertEqual(p.slug, "demo")
        XCTAssertEqual(p.title, "Demo")
        XCTAssertEqual(p.status, "running")
    }
    func testProjectToleratesMissingFields() {
        let p = Project(slug: "x", data: [:])
        XCTAssertEqual(p.slug, "x")
        XCTAssertNil(p.title)
        XCTAssertNil(p.status)
    }
    func testTeamRefFromMemberDoc() {
        let t = TeamRef(teamId: "t1", data: ["role": "owner"])
        XCTAssertEqual(t.teamId, "t1"); XCTAssertEqual(t.role, "owner")
    }

    // MARK: – Loop
    func testLoopDecodesBasicFields() {
        let l = Loop(id: "l1", data: ["goal": "Build X", "name": "Loop 1", "order": 2,
                                      "status": "running", "currentPhaseId": "p1"])
        XCTAssertEqual(l.id, "l1")
        XCTAssertEqual(l.goal, "Build X")
        XCTAssertEqual(l.name, "Loop 1")
        XCTAssertEqual(l.order, 2)
        XCTAssertEqual(l.status, "running")
        XCTAssertEqual(l.currentPhaseId, "p1")
    }
    func testLoopToleratesMissingFields() {
        let l = Loop(id: "l2", data: [:])
        XCTAssertNil(l.goal); XCTAssertNil(l.status); XCTAssertNil(l.startedAt)
    }

    // MARK: – Phase
    func testPhaseDecodesFields() {
        let p = Phase(id: "ph1", data: ["name": "Phase A", "order": 1, "status": "done"])
        XCTAssertEqual(p.name, "Phase A"); XCTAssertEqual(p.order, 1); XCTAssertEqual(p.status, "done")
    }

    // MARK: – Commit + CommitTokens
    func testCommitDecodesTokens() {
        let tokenData: [String: Any] = ["input": 10, "output": 20, "cacheRead": 5, "cacheWrite": 3, "total": 38]
        let c = Commit(id: "sha1", data: ["message": "fix bug", "author": "ravi", "tokens": tokenData])
        XCTAssertEqual(c.id, "sha1")
        XCTAssertEqual(c.message, "fix bug")
        XCTAssertEqual(c.tokens?.input, 10)
        XCTAssertEqual(c.tokens?.output, 20)
        XCTAssertEqual(c.tokens?.cacheRead, 5)
        XCTAssertEqual(c.tokens?.cacheWrite, 3)
        XCTAssertEqual(c.tokens?.total, 38)
    }
    func testCommitTokensDefaultsToZero() {
        let t = CommitTokens(data: [:])
        XCTAssertEqual(t.input, 0); XCTAssertEqual(t.total, 0)
    }

    // MARK: – RubricCriterion + Goal
    func testRubricCriterionDecodes() {
        let rc = RubricCriterion(id: "c1", data: ["name": "Quality", "weight": 1.0, "max": 5.0])
        XCTAssertEqual(rc.id, "c1"); XCTAssertEqual(rc.name, "Quality")
        XCTAssertEqual(rc.weight, 1.0); XCTAssertEqual(rc.max, 5.0)
    }
    func testGoalDecodes() {
        let g = Goal(id: "g1", data: ["title": "Ship it", "description": "desc", "order": 1])
        XCTAssertEqual(g.title, "Ship it"); XCTAssertEqual(g.order, 1)
    }

    // MARK: – Scenario (rubric flatten + threshold)
    func testScenarioDecodesRubricAndThreshold() {
        let s = Scenario(id: "s1", data: ["title": "T", "threshold": 70,
            "rubric": ["criteria": [["id":"c1","name":"n","weight":1,"max":5]]]])
        XCTAssertEqual(s.threshold, 70)
        XCTAssertEqual(s.rubric?.first?.name, "n")
    }
    func testScenarioToleratesMissingRubric() {
        let s = Scenario(id: "s2", data: ["title": "No rubric"])
        XCTAssertNil(s.rubric); XCTAssertNil(s.threshold)
    }

    // MARK: – ProjectTask (named ProjectTask to avoid shadowing Swift's Task concurrency type)
    func testProjectTaskDecodes() {
        let t = ProjectTask(id: "t1", data: ["phaseId": "p1", "title": "Do X", "order": 0,
                                             "status": "todo", "scenarioIds": ["s1","s2"]])
        XCTAssertEqual(t.phaseId, "p1"); XCTAssertEqual(t.scenarioIds?.count, 2)
    }

    // MARK: – Score
    func testScoreDecodesCriteria() {
        let criteriaData: [String: Any] = ["accuracy": NSNumber(value: 0.9), "speed": NSNumber(value: 0.7)]
        let s = Score(id: "sc1", data: ["scenarioId": "s1", "composite": 0.8,
                                        "criteria": criteriaData, "by": "agent"])
        XCTAssertEqual(s.scenarioId, "s1")
        XCTAssertEqual(s.composite, 0.8)
        XCTAssertEqual(s.criteria?["accuracy"], 0.9)
        XCTAssertEqual(s.by, "agent")
    }

    // MARK: – TestRun
    func testTestRunDecodesCountsAndIssues() {
        let r = TestRun(id: "01", data: ["passed": 3, "failed": 1, "issues": ["a","b"], "scenarioId":"s1"])
        XCTAssertEqual(r.passed, 3); XCTAssertEqual(r.failed, 1); XCTAssertEqual(r.issues?.count, 2)
    }

    // MARK: – Revision (trigger flatten)
    func testRevisionFlattensTrigger() {
        let r = Revision(id: "r1", data: ["trigger": ["scenarioId":"s1","reason":"why"],
            "changes": [["op":"add","taskId":"t1"]]])
        XCTAssertEqual(r.triggerScenarioId, "s1"); XCTAssertEqual(r.changes?.first?.op, "add")
    }
    func testRevisionToleratesMissingTrigger() {
        let r = Revision(id: "r2", data: [:])
        XCTAssertNil(r.triggerScenarioId); XCTAssertNil(r.changes)
    }

    // MARK: – DocumentRec
    func testDocumentRecDecodes() {
        let d = DocumentRec(id: "d1", data: ["kind": "vision", "title": "V", "format": "markdown", "content": "# Hi"])
        XCTAssertEqual(d.kind, "vision"); XCTAssertEqual(d.format, "markdown"); XCTAssertEqual(d.content, "# Hi")
    }

    // MARK: – Bug + Message
    func testBugAndMessageDecode() {
        XCTAssertEqual(Bug(id:"b1", data:["severity":"high","status":"open"]).severity, "high")
        XCTAssertEqual(Message(id:"m1", data:["text":"hi","author":"user"]).author, "user")
    }
    func testMessageDefaultsTextAndAuthor() {
        let m = Message(id: "m2", data: [:])
        XCTAssertEqual(m.text, ""); XCTAssertEqual(m.author, "agent")
    }

    // MARK: – SessionEntry + SessionDoc
    func testSessionEntryToolDecode() {
        let d = SessionDoc(id: "S1", data: ["startedAt": 1.0, "endedAt": 2.0,
            "entries": [["kind":"tool","name":"Bash","summary":"ls","ok":true,"ts":1]]])
        guard case .tool(let name, _, let ok, _)? = d.entries.first else { return XCTFail() }
        XCTAssertEqual(name, "Bash"); XCTAssertTrue(ok)
    }
    func testSessionEntryUserAndAssistant() {
        let d = SessionDoc(id: "S2", data: ["startedAt": 0.0, "endedAt": 1.0,
            "entries": [
                ["kind":"user","text":"hello","ts":1],
                ["kind":"assistant","text":"world","ts":2],
                ["kind":"unknown","ts":3]
            ]])
        XCTAssertEqual(d.entries.count, 2)
        if case .user(let text, _) = d.entries[0] { XCTAssertEqual(text, "hello") } else { XCTFail() }
        if case .assistant(let text, _) = d.entries[1] { XCTAssertEqual(text, "world") } else { XCTFail() }
    }
    func testSessionDocTimestamps() {
        let d = SessionDoc(id: "S3", data: ["startedAt": 100.5, "endedAt": 200.0, "entries": []])
        XCTAssertEqual(d.startedAt, 100.5); XCTAssertEqual(d.endedAt, 200.0)
    }
}
