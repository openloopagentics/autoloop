import Foundation

enum ProjectDetailTab: String, CaseIterable, Identifiable {
    case dashboard, vision, loops, tests, bugs, ideas, messages
    var id: String { rawValue }
    var title: String {
        switch self {
        case .dashboard: "Dashboard"
        case .vision: "Vision"
        case .loops: "Loops"
        case .tests: "Tests"
        case .bugs: "Bugs"
        case .ideas: "Ideas"
        case .messages: "Messages"
        }
    }
}
