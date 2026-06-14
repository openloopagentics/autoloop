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

    // MARK: - Idea writes

    /// PUT /ideas/{id} — create / accept / reject / reorder / mark done.
    static func putIdea(teamId: String, slug: String, id: String, body: IdeaBody) async throws {
        try await send(method: "PUT", url: url(teamId, slug, "/ideas/\(id)"), jsonBody: body.jsonObject)
    }

    // MARK: - Vision-change writes

    /// POST /vision-changes/{id}/reject — revert an applied change to its prior state.
    static func rejectVisionChange(teamId: String, slug: String, id: String) async throws {
        try await send(method: "POST", url: url(teamId, slug, "/vision-changes/\(id)/reject"), jsonBody: [:])
    }

    // MARK: - Project writes

    /// DELETE project (no rest path).
    static func deleteProject(teamId: String, slug: String) async throws {
        try await send(method: "DELETE", url: url(teamId, slug), jsonBody: nil)
    }

    // MARK: - Generic top-level (non-project) endpoints
    // Built from AppConfig.apiBaseURL + path (keys/admin are not under /teams/.../projects).

    private static func apiURL(_ path: String) -> URL {
        URL(string: "\(AppConfig.apiBaseURL)\(path)")!
    }

    /// GET decoding into T.
    static func get<T: Decodable>(_ path: String) async throws -> T {
        var req = URLRequest(url: apiURL(path))
        req.httpMethod = "GET"
        req.setValue(try await authHeader(), forHTTPHeaderField: "Authorization")
        let (data, resp) = try await URLSession.shared.data(for: req)
        try check(data, resp)
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// POST with a JSON body, decoding the response into T.
    static func post<T: Decodable>(_ path: String, jsonBody: [String: Any]) async throws -> T {
        var req = URLRequest(url: apiURL(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(try await authHeader(), forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONSerialization.data(withJSONObject: jsonBody)
        let (data, resp) = try await URLSession.shared.data(for: req)
        try check(data, resp)
        return try JSONDecoder().decode(T.self, from: data)
    }

    // MARK: - Keys (mirrors keys/client.ts)

    private struct KeysEnvelope: Decodable { let keys: [KeyMeta] }

    static func listKeys() async throws -> [KeyMeta] {
        let env: KeysEnvelope = try await get("/v1/keys")
        return env.keys
    }

    static func mintKey(label: String) async throws -> MintedKey {
        try await post("/v1/keys", jsonBody: ["label": label])
    }

    static func revokeKey(id: String) async throws {
        try await send(method: "DELETE", url: apiURL("/v1/keys/\(id)"), jsonBody: nil)
    }

    // MARK: - Admin (mirrors admin/client.ts)

    private struct UsersEnvelope: Decodable { let users: [AdminUser] }
    private struct RequestsEnvelope: Decodable { let requests: [AccessRequest] }

    static func listUsers() async throws -> [AdminUser] {
        let env: UsersEnvelope = try await get("/v1/admin/users")
        return env.users
    }

    static func setAllowed(uid: String, isAllowed: Bool, email: String? = nil) async throws {
        var body: [String: Any] = ["isAllowed": isAllowed]
        if let email { body["email"] = email }
        try await send(method: "PUT", url: apiURL("/v1/admin/users/\(uid)"), jsonBody: body)
    }

    static func listAccessRequests() async throws -> [AccessRequest] {
        let env: RequestsEnvelope = try await get("/v1/admin/access-requests")
        return env.requests
    }

    static func decideAccessRequest(uid: String, decision: String) async throws {
        try await send(method: "POST", url: apiURL("/v1/admin/access-requests/\(uid)"),
                       jsonBody: ["decision": decision])
    }
}
