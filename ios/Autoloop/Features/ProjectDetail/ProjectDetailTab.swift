import Foundation

enum ProjectDetailTab: String, CaseIterable, Identifiable {
    case dashboard, vision, loops, tests, bugs, messages
    var id: String { rawValue }
    var title: String {
        switch self {
        case .dashboard: "Dashboard"
        case .vision: "Vision"
        case .loops: "Loops"
        case .tests: "Tests"
        case .bugs: "Bugs"
        case .messages: "Messages"
        }
    }
}
