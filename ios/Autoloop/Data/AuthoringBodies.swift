import Foundation

// MARK: - Authoring body structs
// These represent the JSON shapes sent to the API when creating/updating goals,
// scenarios, and documents. Nil optionals are omitted from the encoded output
// to match the web client, which only sets fields that are provided.

struct GoalBody {
    var title: String
    var description: String?
    var order: Int?

    var jsonObject: [String: Any] {
        var d: [String: Any] = ["title": title]
        if let v = description { d["description"] = v }
        if let v = order { d["order"] = v }
        return d
    }
}

struct RubricCriterionBody {
    var id: String
    var name: String
    var weight: Double
    var max: Double

    var jsonObject: [String: Any] {
        ["id": id, "name": name, "weight": weight, "max": max]
    }
}

struct RubricBody {
    var criteria: [RubricCriterionBody]

    var jsonObject: [String: Any] {
        ["criteria": criteria.map { $0.jsonObject }]
    }
}

struct ScenarioBody {
    var goalId: String?
    var title: String
    var description: String?
    var order: Int?
    var threshold: Int?
    var rubric: RubricBody

    var jsonObject: [String: Any] {
        var d: [String: Any] = [
            "title": title,
            "rubric": rubric.jsonObject
        ]
        if let v = goalId { d["goalId"] = v }
        if let v = description { d["description"] = v }
        if let v = order { d["order"] = v }
        if let v = threshold { d["threshold"] = v }
        return d
    }
}

struct DocumentBody {
    var kind: String
    var title: String
    var format: String
    var content: String

    var jsonObject: [String: Any] {
        ["kind": kind, "title": title, "format": format, "content": content]
    }
}
