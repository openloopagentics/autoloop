import Foundation
import FirebaseAuth

/// API error carrying the HTTP status code and raw response body where available,
/// so call sites can branch on `statusCode` (e.g. 401/403/404) instead of parsing
/// a flattened message. `errorDescription` keeps the human-readable text shown today.
struct ApiError: LocalizedError {
    let message: String
    let statusCode: Int?
    let body: String?

    init(message: String, statusCode: Int? = nil, body: String? = nil) {
        self.message = message
        self.statusCode = statusCode
        self.body = body
    }

    var errorDescription: String? { message }
}

/// Serialises access to a cached Firebase ID token. We keep our own 5-minute TTL on
/// top of Firebase's internal cache: a hit avoids even the (cheap, but lock-taking)
/// `getIDToken()` round-trip, and on a 401 we force-refresh exactly once and retry.
/// `getIDTokenForcingRefresh(false)` already returns Firebase's cached token while it
/// is valid, so this is purely an extra short-lived layer — never a staleness risk
/// beyond the TTL.
actor TokenProvider {
    static let shared = TokenProvider()

    private var cached: CachedToken?
    private let ttl: TimeInterval = 5 * 60   // reuse a token for up to 5 minutes

    /// Returns a bearer ID token. Pass `forceRefresh` after a 401 to mint a fresh one.
    func token(forceRefresh: Bool = false) async throws -> String {
        let now = Date()
        if !forceRefresh, let cached, cached.isFresh(ttl: ttl, now: now) {
            return cached.value
        }
        guard let user = Auth.auth().currentUser else {
            cached = nil
            throw ApiError(message: "Not signed in")
        }
        let token = try await user.getIDTokenResult(forcingRefresh: forceRefresh).token
        cached = CachedToken(value: token, fetchedAt: now)
        return token
    }
}

enum RestClient {
    /// Shared session with explicit per-request / per-resource timeouts (the
    /// `URLSession.shared` defaults are 60s/7d, far too lenient for a UI).
    private static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        return URLSession(configuration: config)
    }()

    /// Build an `ApiError` from a non-2xx response, preserving the status + raw body.
    private static func apiError(data: Data, statusCode: Int) -> ApiError {
        let msg = (try? JSONSerialization.jsonObject(with: data))
            .flatMap { ($0 as? [String: Any])?["error"] as? [String: Any] }?["message"] as? String
        return ApiError(message: msg ?? "HTTP \(statusCode)",
                        statusCode: statusCode,
                        body: String(data: data, encoding: .utf8))
    }

    /// Core request path: cached auth token, 401 → force-refresh-once + retry, and
    /// exponential-backoff retry of transient failures (network errors, 5xx, 429) for
    /// idempotent methods only. Returns the validated response body on success.
    private static func execute(method: String, url: URL, jsonBody: [String: Any]?) async throws -> Data {
        let retryTransient = RetryPolicy.isIdempotent(method: method)
        var didForceRefresh = false
        var attempt = 0

        while true {
            let token = try await TokenProvider.shared.token()
            var req = URLRequest(url: url)
            req.httpMethod = method
            if jsonBody != nil { req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            if let body = jsonBody { req.httpBody = try JSONSerialization.data(withJSONObject: body) }

            do {
                let (data, resp) = try await session.data(for: req)
                let status = (resp as? HTTPURLResponse)?.statusCode

                // 401: our token may be stale — force one refresh and retry. The
                // rejected request was never processed, so this is safe even for POSTs.
                if status == 401, !didForceRefresh {
                    didForceRefresh = true
                    _ = try? await TokenProvider.shared.token(forceRefresh: true)
                    continue
                }

                // Non-HTTP response or 2xx → success (mirrors the old `check`).
                guard let status, !(200..<300).contains(status) else { return data }

                let err = apiError(data: data, statusCode: status)
                if retryTransient, RetryPolicy.isRetryable(statusCode: status),
                   attempt + 1 < RetryPolicy.maxAttempts {
                    try await Task.sleep(nanoseconds: RetryPolicy.backoffNanos(attempt: attempt))
                    attempt += 1
                    continue
                }
                throw err
            } catch let urlErr as URLError {
                if retryTransient, RetryPolicy.isRetryable(urlError: urlErr),
                   attempt + 1 < RetryPolicy.maxAttempts {
                    try await Task.sleep(nanoseconds: RetryPolicy.backoffNanos(attempt: attempt))
                    attempt += 1
                    continue
                }
                throw urlErr
            }
        }
    }

    private static func url(_ teamId: String, _ slug: String, _ rest: String = "") -> URL {
        URL(string: "\(AppConfig.apiBaseURL)/v1/u/teams/\(teamId)/projects/\(slug)\(rest)")!
    }

    /// Mirrors api.ts putProject: defaults status to "running".
    static func putProject(teamId: String, slug: String, title: String, status: String = "running") async throws {
        _ = try await execute(method: "PUT", url: url(teamId, slug),
                              jsonBody: ["title": title, "status": status])
    }

    /// Mirrors api.ts postMessage: POST /messages with { text }.
    static func postMessage(teamId: String, slug: String, text: String) async throws {
        _ = try await execute(method: "POST", url: url(teamId, slug, "/messages"),
                              jsonBody: ["text": text])
    }

    // MARK: - Generic send helper

    private static func send(method: String, url: URL, jsonBody: [String: Any]?) async throws {
        _ = try await execute(method: method, url: url, jsonBody: jsonBody)
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
        let data = try await execute(method: "GET", url: apiURL(path), jsonBody: nil)
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// POST with a JSON body, decoding the response into T.
    static func post<T: Decodable>(_ path: String, jsonBody: [String: Any]) async throws -> T {
        let data = try await execute(method: "POST", url: apiURL(path), jsonBody: jsonBody)
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
