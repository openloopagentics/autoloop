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
}
