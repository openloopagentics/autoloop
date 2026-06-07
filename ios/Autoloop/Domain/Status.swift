import Foundation

/// Semantic status colors (mirrors the web's color classes; mapped to real colors in Theme).
enum StatusColor { case gray, blue, red, amber, green }

private let statusColors: [String: StatusColor] = [
    "queued": .gray, "running": .blue, "blocked": .red, "paused": .amber,
    "completed": .green, "failed": .red, "cancelled": .gray,
]

func statusColor(_ status: String) -> StatusColor { statusColors[status] ?? .gray }

private let terminalStatuses: Set<String> = ["completed", "failed", "cancelled"]
func isTerminalStatus(_ status: String) -> Bool { terminalStatuses.contains(status) }
