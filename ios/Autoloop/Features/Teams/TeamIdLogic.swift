import Foundation

/// Ports web/src/teams/teamId.ts.

/// lowercase; replace runs of `[^a-z0-9._-]` with `-`; strip leading/trailing `-`/`.`; fallback "team".
func slugifyTeam(_ name: String) -> String {
    let lowered = name.lowercased()
    let collapsed = lowered.replacingOccurrences(
        of: "[^a-z0-9._-]+", with: "-", options: .regularExpression)
    let trimmed = collapsed.replacingOccurrences(
        of: "^[-.]+|[-.]+$", with: "", options: .regularExpression)
    return trimmed.isEmpty ? "team" : trimmed
}

/// Random 4-char base36 string (lowercase a-z0-9).
func defaultTeamSuffix() -> String {
    let chars = Array("0123456789abcdefghijklmnopqrstuvwxyz")
    return String((0..<4).map { _ in chars.randomElement()! })
}

func teamIdFromName(_ name: String, suffix: () -> String = { defaultTeamSuffix() }) -> String {
    "\(slugifyTeam(name))-\(suffix())"
}
