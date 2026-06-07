import Foundation

struct TeamRef: Identifiable, Equatable {
    let teamId: String; let role: String
    var id: String { teamId }
    init(teamId: String, role: String) { self.teamId = teamId; self.role = role }
    init(teamId: String, data: [String: Any]) {
        self.init(teamId: teamId, role: data.str("role") ?? "")
    }
}

struct Team: Equatable { let name: String?
    init(name: String?) { self.name = name }
    init(data: [String: Any]) { self.init(name: data.str("name")) }
}

struct Project: Identifiable, Equatable {
    let slug: String
    let title: String?
    let status: String?
    let currentLoopId: String?
    var id: String { slug }
    init(slug: String, title: String? = nil, status: String? = nil, currentLoopId: String? = nil) {
        self.slug = slug; self.title = title; self.status = status; self.currentLoopId = currentLoopId
    }
    init(slug: String, data: [String: Any]) {
        self.init(slug: slug, title: data.str("title"), status: data.str("status"),
                  currentLoopId: data.str("currentLoopId"))
    }
}
