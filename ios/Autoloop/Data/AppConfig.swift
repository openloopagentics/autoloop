import Foundation

enum AppConfig {
    static var apiBaseURL: String {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String) ?? ""
        return raw.hasSuffix("/") ? String(raw.dropLast()) : raw   // mirror api.ts replace(/\/$/, "")
    }
}
