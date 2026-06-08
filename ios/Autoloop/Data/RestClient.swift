import Foundation
import FirebaseAuth

struct ApiError: LocalizedError { let message: String; var errorDescription: String? { message } }

enum RestClient {
    private static func authHeader() async throws -> String {
        guard let user = Auth.auth().currentUser else { throw ApiError(message: "Not signed in") }
        let token = try await user.getIDToken()
        return "Bearer \(token)"
    }

    private static func check(_ data: Data, _ resp: URLResponse) throws {
        guard let http = resp as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            let msg = (try? JSONSerialization.jsonObject(with: data))
                .flatMap { ($0 as? [String: Any])?["error"] as? [String: Any] }?["message"] as? String
            throw ApiError(message: msg ?? "HTTP \(http.statusCode)")
        }
    }

    private static func url(_ teamId: String, _ slug: String, _ rest: String = "") -> URL {
        URL(string: "\(AppConfig.apiBaseURL)/v1/u/teams/\(teamId)/projects/\(slug)\(rest)")!
    }

    /// Mirrors api.ts putProject: defaults status to "running".
    static func putProject(teamId: String, slug: String, title: String, status: String = "running") async throws {
        var req = URLRequest(url: url(teamId, slug))
        req.httpMethod = "PUT"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(try await authHeader(), forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["title": title, "status": status])
        let (data, resp) = try await URLSession.shared.data(for: req)
        try check(data, resp)
    }

    /// Mirrors api.ts postMessage: POST /messages with { text }.
    static func postMessage(teamId: String, slug: String, text: String) async throws {
        var req = URLRequest(url: url(teamId, slug, "/messages"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(try await authHeader(), forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["text": text])
        let (data, resp) = try await URLSession.shared.data(for: req)
        try check(data, resp)
    }

    // MARK: - Generic send helper

    private static func send(method: String, url: URL, jsonBody: [String: Any]?) async throws {
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(try await authHeader(), forHTTPHeaderField: "Authorization")
        if let body = jsonBody {
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, resp) = try await URLSession.shared.data(for: req)
        try check(data, resp)
    }

    // MARK: - Goal writes

    /// PUT /goals/{id}
    static func putGoal(teamId: String, slug: String, id: String, body: GoalBody) async throws {
        try await send(method: "PUT", url: url(teamId, slug, "/goals/\(id)"), jsonBody: body.jsonObject)
    }

    /// DELETE /goals/{id}
    static func deleteGoal(teamId: String, slug: String, id: String) async throws {
        try await send(method: "DELETE", url: url(teamId, slug, "/goals/\(id)"), jsonBody: nil)
    }

    // MARK: - Scenario writes

    /// PUT /scenarios/{id}
    static func putScenario(teamId: String, slug: String, id: String, body: ScenarioBody) async throws {
        try await send(method: "PUT", url: url(teamId, slug, "/scenarios/\(id)"), jsonBody: body.jsonObject)
    }

    /// DELETE /scenarios/{id}
    static func deleteScenario(teamId: String, slug: String, id: String) async throws {
        try await send(method: "DELETE", url: url(teamId, slug, "/scenarios/\(id)"), jsonBody: nil)
    }

    // MARK: - Document writes

    /// PUT /documents/{id}
    static func putDocument(teamId: String, slug: String, id: String, body: DocumentBody) async throws {
        try await send(method: "PUT", url: url(teamId, slug, "/documents/\(id)"), jsonBody: body.jsonObject)
    }

    /// DELETE /documents/{id}
    static func deleteDocument(teamId: String, slug: String, id: String) async throws {
        try await send(method: "DELETE", url: url(teamId, slug, "/documents/\(id)"), jsonBody: nil)
    }

    // MARK: - Project writes

    /// DELETE project (no rest path).
    static func deleteProject(teamId: String, slug: String) async throws {
        try await send(method: "DELETE", url: url(teamId, slug), jsonBody: nil)
    }
}
