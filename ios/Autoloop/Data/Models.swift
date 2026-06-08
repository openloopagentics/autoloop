import Foundation

// MARK: - SP2 Project-Detail Models

struct Loop: Identifiable {
    let id: String
    let goal: String?
    let name: String?
    let order: Int?
    let status: String?
    let startedAt: Date?
    let endedAt: Date?
    let currentPhaseId: String?
    let currentTaskId: String?
    init(id: String, goal: String? = nil, name: String? = nil, order: Int? = nil,
         status: String? = nil, startedAt: Date? = nil, endedAt: Date? = nil,
         currentPhaseId: String? = nil, currentTaskId: String? = nil) {
        self.id = id; self.goal = goal; self.name = name; self.order = order
        self.status = status; self.startedAt = startedAt; self.endedAt = endedAt
        self.currentPhaseId = currentPhaseId; self.currentTaskId = currentTaskId
    }
    init(id: String, data: [String: Any]) {
        self.init(id: id, goal: data.str("goal"), name: data.str("name"), order: data.int("order"),
                  status: data.str("status"), startedAt: data.date("startedAt"),
                  endedAt: data.date("endedAt"), currentPhaseId: data.str("currentPhaseId"),
                  currentTaskId: data.str("currentTaskId"))
    }
}

struct Phase: Identifiable {
    let id: String
    let name: String?
    let order: Int?
    let status: String?
    let startedAt: Date?
    let endedAt: Date?
    init(id: String, name: String? = nil, order: Int? = nil, status: String? = nil,
         startedAt: Date? = nil, endedAt: Date? = nil) {
        self.id = id; self.name = name; self.order = order; self.status = status
        self.startedAt = startedAt; self.endedAt = endedAt
    }
    init(id: String, data: [String: Any]) {
        self.init(id: id, name: data.str("name"), order: data.int("order"),
                  status: data.str("status"), startedAt: data.date("startedAt"),
                  endedAt: data.date("endedAt"))
    }
}

struct CommitTokens {
    let input: Int
    let output: Int
    let cacheRead: Int
    let cacheWrite: Int
    let total: Int
    init(input: Int = 0, output: Int = 0, cacheRead: Int = 0, cacheWrite: Int = 0, total: Int = 0) {
        self.input = input; self.output = output; self.cacheRead = cacheRead
        self.cacheWrite = cacheWrite; self.total = total
    }
    init(data: [String: Any]) {
        self.init(input: data.int("input") ?? 0, output: data.int("output") ?? 0,
                  cacheRead: data.int("cacheRead") ?? 0, cacheWrite: data.int("cacheWrite") ?? 0,
                  total: data.int("total") ?? 0)
    }
}

struct Commit: Identifiable {
    let id: String   // the sha
    let message: String?
    let author: String?
    let committedAt: Date?
    let tokens: CommitTokens?
    init(id: String, message: String? = nil, author: String? = nil,
         committedAt: Date? = nil, tokens: CommitTokens? = nil) {
        self.id = id; self.message = message; self.author = author
        self.committedAt = committedAt; self.tokens = tokens
    }
    init(id: String, data: [String: Any]) {
        let tokensData = data["tokens"] as? [String: Any]
        self.init(id: id, message: data.str("message"), author: data.str("author"),
                  committedAt: data.date("committedAt"),
                  tokens: tokensData.map { CommitTokens(data: $0) })
    }
}

struct RubricCriterion: Identifiable {
    let id: String
    let name: String
    let weight: Double
    let max: Double
    init(id: String, name: String, weight: Double, max: Double) {
        self.id = id; self.name = name; self.weight = weight; self.max = max
    }
    init(id: String, data: [String: Any]) {
        self.init(id: id, name: data.str("name") ?? "",
                  weight: data.double("weight") ?? 0, max: data.double("max") ?? 0)
    }
}

struct Goal: Identifiable {
    let id: String
    let title: String?
    let description: String?
    let order: Int?
    init(id: String, title: String? = nil, description: String? = nil, order: Int? = nil) {
        self.id = id; self.title = title; self.description = description; self.order = order
    }
    init(id: String, data: [String: Any]) {
        self.init(id: id, title: data.str("title"), description: data.str("description"),
                  order: data.int("order"))
    }
}

struct Scenario: Identifiable {
    let id: String
    let goalId: String?
    let title: String?
    let description: String?
    let order: Int?
    let threshold: Int?
    let rubric: [RubricCriterion]?  // flattened from rubric.criteria
    init(id: String, goalId: String? = nil, title: String? = nil, description: String? = nil,
         order: Int? = nil, threshold: Int? = nil, rubric: [RubricCriterion]? = nil) {
        self.id = id; self.goalId = goalId; self.title = title; self.description = description
        self.order = order; self.threshold = threshold; self.rubric = rubric
    }
    init(id: String, data: [String: Any]) {
        let criteriaArray = (data["rubric"] as? [String: Any])?["criteria"] as? [[String: Any]]
        let rubric = criteriaArray?.compactMap { d -> RubricCriterion? in
            guard let cid = d.str("id") else { return nil }
            return RubricCriterion(id: cid, data: d)
        }
        self.init(id: id, goalId: data.str("goalId"), title: data.str("title"),
                  description: data.str("description"), order: data.int("order"),
                  threshold: data.int("threshold"), rubric: rubric?.isEmpty == false ? rubric : nil)
    }
}

/// Renamed from `Task` to avoid shadowing Swift's concurrency `Task` type.
struct ProjectTask: Identifiable {
    let id: String
    let phaseId: String?
    let title: String?
    let order: Int?
    let status: String?
    let scenarioIds: [String]?
    init(id: String, phaseId: String? = nil, title: String? = nil, order: Int? = nil,
         status: String? = nil, scenarioIds: [String]? = nil) {
        self.id = id; self.phaseId = phaseId; self.title = title; self.order = order
        self.status = status; self.scenarioIds = scenarioIds
    }
    init(id: String, data: [String: Any]) {
        self.init(id: id, phaseId: data.str("phaseId"), title: data.str("title"),
                  order: data.int("order"), status: data.str("status"),
                  scenarioIds: data["scenarioIds"] as? [String])
    }
}

struct Score: Identifiable {
    let id: String
    let scenarioId: String?
    let taskId: String?
    let criteria: [String: Double]?
    let composite: Double?
    let by: String?
    let note: String?
    let commitSha: String?
    init(id: String, scenarioId: String? = nil, taskId: String? = nil,
         criteria: [String: Double]? = nil, composite: Double? = nil,
         by: String? = nil, note: String? = nil, commitSha: String? = nil) {
        self.id = id; self.scenarioId = scenarioId; self.taskId = taskId
        self.criteria = criteria; self.composite = composite
        self.by = by; self.note = note; self.commitSha = commitSha
    }
    init(id: String, data: [String: Any]) {
        let criteriaRaw = data["criteria"] as? [String: Any]
        var criteriaDecoded: [String: Double]? = nil
        if let raw = criteriaRaw {
            var d: [String: Double] = [:]
            for (k, v) in raw {
                if let n = v as? NSNumber { d[k] = n.doubleValue }
                else if let dv = v as? Double { d[k] = dv }
            }
            criteriaDecoded = d.isEmpty ? nil : d
        }
        self.init(id: id, scenarioId: data.str("scenarioId"), taskId: data.str("taskId"),
                  criteria: criteriaDecoded, composite: data.double("composite"),
                  by: data.str("by"), note: data.str("note"), commitSha: data.str("commitSha"))
    }
}

struct TestRun: Identifiable {
    let id: String
    let scenarioId: String?
    let taskId: String?
    let passed: Int?
    let failed: Int?
    let issues: [String]?
    let summary: String?
    let loopId: String?
    init(id: String, scenarioId: String? = nil, taskId: String? = nil,
         passed: Int? = nil, failed: Int? = nil, issues: [String]? = nil,
         summary: String? = nil, loopId: String? = nil) {
        self.id = id; self.scenarioId = scenarioId; self.taskId = taskId
        self.passed = passed; self.failed = failed; self.issues = issues
        self.summary = summary; self.loopId = loopId
    }
    init(id: String, data: [String: Any]) {
        self.init(id: id, scenarioId: data.str("scenarioId"), taskId: data.str("taskId"),
                  passed: data.int("passed"), failed: data.int("failed"),
                  issues: data["issues"] as? [String], summary: data.str("summary"),
                  loopId: data.str("loopId"))
    }
}

struct RevisionChange {
    let op: String
    let taskId: String
    init(op: String, taskId: String) { self.op = op; self.taskId = taskId }
    init(data: [String: Any]) {
        self.init(op: data.str("op") ?? "", taskId: data.str("taskId") ?? "")
    }
}

struct Revision: Identifiable {
    let id: String
    let triggerScenarioId: String?   // flattened from trigger.scenarioId
    let triggerReason: String?       // flattened from trigger.reason
    let changes: [RevisionChange]?
    init(id: String, triggerScenarioId: String? = nil, triggerReason: String? = nil,
         changes: [RevisionChange]? = nil) {
        self.id = id; self.triggerScenarioId = triggerScenarioId
        self.triggerReason = triggerReason; self.changes = changes
    }
    init(id: String, data: [String: Any]) {
        let trigger = data["trigger"] as? [String: Any]
        let changesRaw = data["changes"] as? [[String: Any]]
        self.init(id: id,
                  triggerScenarioId: trigger?.str("scenarioId"),
                  triggerReason: trigger?.str("reason"),
                  changes: changesRaw?.map { RevisionChange(data: $0) })
    }
}

struct DocumentRec: Identifiable {
    let id: String
    let kind: String?
    let title: String?
    let format: String?
    let content: String?
    init(id: String, kind: String? = nil, title: String? = nil,
         format: String? = nil, content: String? = nil) {
        self.id = id; self.kind = kind; self.title = title
        self.format = format; self.content = content
    }
    init(id: String, data: [String: Any]) {
        self.init(id: id, kind: data.str("kind"), title: data.str("title"),
                  format: data.str("format"), content: data.str("content"))
    }
}

struct Bug: Identifiable {
    let id: String
    let title: String?
    let description: String?
    let scenarioId: String?
    let taskId: String?
    let severity: String?
    let status: String?
    let createdAt: Date?
    let updatedAt: Date?
    let fixedAt: Date?
    let loopId: String?
    init(id: String, title: String? = nil, description: String? = nil,
         scenarioId: String? = nil, taskId: String? = nil, severity: String? = nil,
         status: String? = nil, createdAt: Date? = nil, updatedAt: Date? = nil,
         fixedAt: Date? = nil, loopId: String? = nil) {
        self.id = id; self.title = title; self.description = description
        self.scenarioId = scenarioId; self.taskId = taskId; self.severity = severity
        self.status = status; self.createdAt = createdAt; self.updatedAt = updatedAt
        self.fixedAt = fixedAt; self.loopId = loopId
    }
    init(id: String, data: [String: Any]) {
        self.init(id: id, title: data.str("title"), description: data.str("description"),
                  scenarioId: data.str("scenarioId"), taskId: data.str("taskId"),
                  severity: data.str("severity"), status: data.str("status"),
                  createdAt: data.date("createdAt"), updatedAt: data.date("updatedAt"),
                  fixedAt: data.date("fixedAt"), loopId: data.str("loopId"))
    }
}

struct Message: Identifiable {
    let id: String
    let text: String
    let author: String
    let status: String?
    let createdAt: Date?
    let deliveredAt: Date?
    init(id: String, text: String = "", author: String = "agent",
         status: String? = nil, createdAt: Date? = nil, deliveredAt: Date? = nil) {
        self.id = id; self.text = text; self.author = author
        self.status = status; self.createdAt = createdAt; self.deliveredAt = deliveredAt
    }
    init(id: String, data: [String: Any]) {
        self.init(id: id, text: data.str("text") ?? "",
                  author: data.str("author") ?? "agent",
                  status: data.str("status"),
                  createdAt: data.date("createdAt"),
                  deliveredAt: data.date("deliveredAt"))
    }
}

enum SessionEntry {
    case user(text: String, ts: Double)
    case assistant(text: String, ts: Double)
    case tool(name: String, summary: String, ok: Bool, ts: Double)
}

struct SessionDoc: Identifiable {
    let id: String    // the sessionId
    let startedAt: Double
    let endedAt: Double
    let entries: [SessionEntry]
    init(id: String, startedAt: Double = 0, endedAt: Double = 0, entries: [SessionEntry] = []) {
        self.id = id; self.startedAt = startedAt; self.endedAt = endedAt; self.entries = entries
    }
    init(id: String, data: [String: Any]) {
        let rawEntries = data["entries"] as? [[String: Any]] ?? []
        let entries: [SessionEntry] = rawEntries.compactMap { e in
            let ts = (e["ts"] as? NSNumber)?.doubleValue ?? 0
            switch e.str("kind") {
            case "user":      return .user(text: e.str("text") ?? "", ts: ts)
            case "assistant": return .assistant(text: e.str("text") ?? "", ts: ts)
            case "tool":      return .tool(name: e.str("name") ?? "",
                                           summary: e.str("summary") ?? "",
                                           ok: e["ok"] as? Bool ?? false,
                                           ts: ts)
            default: return nil
            }
        }
        self.init(id: id,
                  startedAt: (data["startedAt"] as? NSNumber)?.doubleValue ?? 0,
                  endedAt: (data["endedAt"] as? NSNumber)?.doubleValue ?? 0,
                  entries: entries)
    }
}

// MARK: - SP3b Account / Team / Admin Models

enum Role: String, Codable { case owner, admin, member }

struct Member: Identifiable {
    let uid: String
    let role: Role
    let email: String?
    var id: String { uid }
    init(uid: String, role: Role, email: String? = nil) {
        self.uid = uid; self.role = role; self.email = email
    }
    init(id: String, data: [String: Any]) {
        self.init(uid: id,
                  role: Role(rawValue: data.str("role") ?? "member") ?? .member,
                  email: data.str("email"))
    }
}

struct Invite: Identifiable {
    let id: String
    let teamId: String?
    let email: String
    let role: Role
    let status: String?
    init(id: String, teamId: String? = nil, email: String, role: Role, status: String? = nil) {
        self.id = id; self.teamId = teamId; self.email = email; self.role = role; self.status = status
    }
    init(id: String, teamId: String?, data: [String: Any]) {
        self.init(id: id, teamId: teamId,
                  email: data.str("email") ?? "",
                  role: Role(rawValue: data.str("role") ?? "member") ?? .member,
                  status: data.str("status"))
    }
}

// MARK: - REST (Keys / Admin) Codable Models

/// The REST API returns Firestore Admin `Timestamp` values raw, which JSON-serialize
/// to an object (`{_seconds,_nanoseconds}` or `{seconds,nanoseconds}`), NOT a number.
/// Decode all shapes — a raw epoch number, or either timestamp object — to epoch SECONDS.
struct FlexTimestamp: Decodable {
    let seconds: Double?
    init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(), let n = try? single.decode(Double.self) {
            seconds = n
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        seconds = (try? c.decodeIfPresent(Double.self, forKey: ._seconds))
            ?? (try? c.decodeIfPresent(Double.self, forKey: .seconds)) ?? nil
    }
    enum CodingKeys: String, CodingKey { case _seconds, seconds }
}

struct KeyMeta: Codable, Identifiable {
    let id: String
    let label: String
    let prefix: String
    let createdAt: Double?   // epoch seconds
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        label = try c.decode(String.self, forKey: .label)
        prefix = try c.decode(String.self, forKey: .prefix)
        createdAt = (try c.decodeIfPresent(FlexTimestamp.self, forKey: .createdAt))?.seconds
    }
}

struct MintedKey: Codable {
    let id: String
    let label: String
    let prefix: String
    let key: String
    let createdAt: Double?   // epoch seconds
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        label = try c.decode(String.self, forKey: .label)
        prefix = try c.decode(String.self, forKey: .prefix)
        key = try c.decode(String.self, forKey: .key)
        createdAt = (try c.decodeIfPresent(FlexTimestamp.self, forKey: .createdAt))?.seconds
    }
}

struct AdminUser: Codable, Identifiable {
    let uid: String
    let email: String?
    let isAllowed: Bool
    let isAdmin: Bool
    var id: String { uid }
}

struct AccessRequest: Codable, Identifiable {
    let uid: String
    let email: String?
    let note: String?
    let status: String
    var id: String { uid }
}

// MARK: - SP1 Models

struct TeamRef: Identifiable, Equatable {
    let teamId: String; let role: String
    var id: String { teamId }
    init(teamId: String, role: String) { self.teamId = teamId; self.role = role }
    init(teamId: String, data: [String: Any]) {
        self.init(teamId: teamId, role: data.str("role") ?? "")
    }
}

struct Team: Equatable { let name: String?
    init(name: String?) { self.name = name }
    init(data: [String: Any]) { self.init(name: data.str("name")) }
}

struct ProjectDesign: Equatable {
    let format: String  // "markdown" | "url"
    let content: String
    init(format: String, content: String) { self.format = format; self.content = content }
    init?(data: [String: Any]) {
        guard let format = data.str("format"), let content = data.str("content") else { return nil }
        self.init(format: format, content: content)
    }
}

struct Project: Identifiable, Equatable {
    let slug: String
    let title: String?
    let status: String?
    let currentLoopId: String?
    let currentPhaseId: String?
    let currentTaskId: String?
    let visionOwner: String?  // "web" | "loop"
    let design: ProjectDesign?
    var id: String { slug }
    init(slug: String, title: String? = nil, status: String? = nil, currentLoopId: String? = nil,
         currentPhaseId: String? = nil, currentTaskId: String? = nil,
         visionOwner: String? = nil, design: ProjectDesign? = nil) {
        self.slug = slug; self.title = title; self.status = status; self.currentLoopId = currentLoopId
        self.currentPhaseId = currentPhaseId; self.currentTaskId = currentTaskId
        self.visionOwner = visionOwner; self.design = design
    }
    init(slug: String, data: [String: Any]) {
        self.init(slug: slug, title: data.str("title"), status: data.str("status"),
                  currentLoopId: data.str("currentLoopId"),
                  currentPhaseId: data.str("currentPhaseId"),
                  currentTaskId: data.str("currentTaskId"),
                  visionOwner: data.str("visionOwner"),
                  design: (data["design"] as? [String: Any]).flatMap { ProjectDesign(data: $0) })
    }
}
