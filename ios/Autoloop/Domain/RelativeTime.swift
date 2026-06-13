import Foundation

/// "just now" / "Nm ago" / "Nh ago" / "Nd ago" from a Date (mirrors web relativeTime.ts).
/// Returns "" for a nil date. Rounds to the nearest unit, matching the web's Math.round.
func relativeTime(_ date: Date?, now: Date = Date()) -> String {
    guard let date else { return "" }
    let diff = now.timeIntervalSince(date)
    let min = Int((diff / 60).rounded())
    if min < 1 { return "just now" }
    if min < 60 { return "\(min)m ago" }
    let hr = Int((Double(min) / 60).rounded())
    if hr < 24 { return "\(hr)h ago" }
    return "\(Int((Double(hr) / 24).rounded()))d ago"
}

/// Clock time for a session/loop row, e.g. "2:45 PM" (locale short time).
func shortTime(_ date: Date?) -> String {
    guard let date else { return "" }
    let fmt = DateFormatter()
    fmt.timeStyle = .short
    fmt.dateStyle = .none
    return fmt.string(from: date)
}
