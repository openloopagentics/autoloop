import Foundation

/// Pure product-map DAG derivation — mirrors web mapView.ts.

enum MapNodeType: String { case goal, scenario, task, bug, component }
enum MapNodeState: String { case met, unmet, active, bugged, neutral }

struct MapNode: Identifiable, Equatable {
    var id: String          // namespaced: g:/s:/t:/b:/c: — prevents collisions across collections
    var type: MapNodeType
    var label: String
    var state: MapNodeState
    var done: Bool = false   // terminal task → rendered dimmed
    var loopId: String? = nil // which loop added it (hue band)
}
struct MapEdge: Equatable { var from: String; var to: String }
struct MapGraph: Equatable { var nodes: [MapNode]; var edges: [MapEdge]; var warning: String? = nil }

// Lightweight inputs (decoupled from Firestore models; bridged by the store).
struct MapGoal { var id: String; var title: String? = nil; var createdAt: Date? = nil }
struct MapScenario { var id: String; var title: String? = nil; var goalId: String? = nil
    var threshold: Int? = nil; var createdAt: Date? = nil }
struct MapTask { var id: String; var title: String? = nil; var status: String? = nil
    var scenarioIds: [String]? = nil; var loopId: String? = nil; var createdAt: Date? = nil }
struct MapBug { var id: String; var title: String? = nil; var severity: String? = nil
    var scenarioId: String? = nil; var taskId: String? = nil; var status: String? = nil
    var fixedAt: Date? = nil; var loopId: String? = nil; var createdAt: Date? = nil }

let PRODUCT_MAP_MAX_BYTES = 100 * 1024

struct ProductMapComponent { var id: String; var label: String; var scenarioIds: [String]? }
struct ProductMapDoc { var nodes: [ProductMapComponent]; var edges: [(from: String, to: String)] }

/// Parse + validate the agent-maintained product-map document. Never throws.
func parseProductMap(_ content: String) -> (map: ProductMapDoc?, warning: String?) {
    if content.utf8.count > PRODUCT_MAP_MAX_BYTES {
        return (nil, "product-map document exceeds 100KB — architecture layer not rendered")
    }
    guard let data = content.data(using: .utf8),
          let raw = try? JSONSerialization.jsonObject(with: data) else {
        return (nil, "product-map document is not valid JSON — architecture layer not rendered")
    }
    let bad = "product-map document does not match the expected shape — architecture layer not rendered"
    guard let obj = raw as? [String: Any], let rawNodes = obj["nodes"] as? [[String: Any]] else {
        return (nil, bad)
    }
    let idRe = try! NSRegularExpression(pattern: "^[a-z0-9._-]+$")
    var nodes: [ProductMapComponent] = []
    for n in rawNodes {
        guard let id = n["id"] as? String,
              idRe.firstMatch(in: id, range: NSRange(id.startIndex..., in: id)) != nil,
              let label = n["label"] as? String, !label.isEmpty else { return (nil, bad) }
        nodes.append(ProductMapComponent(id: id, label: label, scenarioIds: n["scenarioIds"] as? [String]))
    }
    var edges: [(from: String, to: String)] = []
    if let rawEdges = obj["edges"] as? [[String: Any]] {
        for e in rawEdges {
            guard let from = e["from"] as? String, let to = e["to"] as? String else { return (nil, bad) }
            edges.append((from, to))
        }
    } else if obj["edges"] != nil && !(obj["edges"] is NSNull) {
        return (nil, bad)
    }
    return (ProductMapDoc(nodes: nodes, edges: edges), nil)
}

/// Deterministic hue per loop so each loop's additions read as a growth ring.
func hueForLoop(_ loopId: String) -> Int {
    var h = 0
    for u in loopId.utf16 { h = (h * 31 + Int(u)) % 360 }
    return h
}

/// Derive the product map DAG. Pure; defensive against agent-written data (edges referencing
/// missing nodes are dropped, never thrown on).
func buildMap(goals: [MapGoal], scenarios: [MapScenario], scenarioStates: [String: MapNodeState],
              tasks: [MapTask], currentTaskId: String?, openBugs: [MapBug],
              productMap: String? = nil) -> MapGraph {
    var nodes: [MapNode] = []

    for g in goals { nodes.append(MapNode(id: "g:\(g.id)", type: .goal, label: g.title ?? g.id, state: .neutral)) }

    let buggedScenarios = Set(openBugs.filter { $0.severity == "high" && $0.scenarioId != nil }.map { $0.scenarioId! })
    for s in scenarios {
        let base = scenarioStates[s.id] ?? .unmet
        nodes.append(MapNode(id: "s:\(s.id)", type: .scenario, label: s.title ?? s.id,
                             state: buggedScenarios.contains(s.id) ? .bugged : base))
    }

    for t in tasks {
        var node = MapNode(id: "t:\(t.id)", type: .task, label: t.title ?? t.id,
                           state: t.id == currentTaskId ? .active : .neutral)
        if let st = t.status, isTerminalStatus(st) { node.done = true }
        if let lid = t.loopId { node.loopId = lid }
        nodes.append(node)
    }

    for b in openBugs {
        var node = MapNode(id: "b:\(b.id)", type: .bug, label: b.title ?? b.id, state: .bugged)
        if let lid = b.loopId { node.loopId = lid }
        nodes.append(node)
    }

    var ids = Set(nodes.map(\.id))
    var edges: [MapEdge] = []
    func push(_ from: String, _ to: String) { if ids.contains(from) && ids.contains(to) { edges.append(MapEdge(from: from, to: to)) } }

    for s in scenarios { if let gid = s.goalId { push("g:\(gid)", "s:\(s.id)") } }
    for t in tasks { for sid in t.scenarioIds ?? [] { push("s:\(sid)", "t:\(t.id)") } }
    for b in openBugs {
        if let tid = b.taskId, ids.contains("t:\(tid)") { push("t:\(tid)", "b:\(b.id)") }
        else if let sid = b.scenarioId { push("s:\(sid)", "b:\(b.id)") }
    }

    var warning: String?
    if let productMap {
        let parsed = parseProductMap(productMap)
        if let w = parsed.warning {
            warning = w
        } else if let map = parsed.map {
            // Worst-of-scenarios: any bugged → bugged, else any unmet → unmet, else met; none → neutral.
            let scnState = Dictionary(uniqueKeysWithValues: nodes.filter { $0.type == .scenario }.map { ($0.id, $0.state) })
            for c in map.nodes {
                let states = (c.scenarioIds ?? []).compactMap { scnState["s:\($0)"] }
                let state: MapNodeState = states.isEmpty ? .neutral
                    : states.contains(.bugged) ? .bugged
                    : states.contains(.unmet) ? .unmet
                    : .met
                nodes.append(MapNode(id: "c:\(c.id)", type: .component, label: c.label, state: state))
            }
            ids = Set(nodes.map(\.id))
            for c in map.nodes {
                for sid in c.scenarioIds ?? [] where ids.contains("s:\(sid)") {
                    edges.append(MapEdge(from: "c:\(c.id)", to: "s:\(sid)"))
                }
            }
            for e in map.edges where ids.contains("c:\(e.from)") && ids.contains("c:\(e.to)") {
                edges.append(MapEdge(from: "c:\(e.from)", to: "c:\(e.to)"))
            }
        }
    }
    return MapGraph(nodes: nodes, edges: edges, warning: warning)
}
