import SwiftUI

/// A layered left-to-right DAG: goals/components → scenarios → tasks → bugs. Replaces the web's
/// dagre+React-Flow layout with a simple column-per-type placement; edges are straight lines
/// between node centres. Pan via the enclosing ScrollView; tap a node to open its detail.
struct MapCanvas: View {
    let nodes: [MapNode]
    let edges: [MapEdge]
    var onTap: ((String) -> Void)? = nil

    private let nodeW: CGFloat = 132, nodeH: CGFloat = 46, hGap: CGFloat = 44, vGap: CGFloat = 14, pad: CGFloat = 16

    private func column(_ t: MapNodeType) -> Int {
        switch t { case .goal, .component: return 0; case .scenario: return 1; case .task: return 2; case .bug: return 3 }
    }

    /// Node centre positions, columns packed top-down in node order.
    private var layout: (positions: [String: CGPoint], size: CGSize) {
        var rowInCol: [Int: Int] = [:]
        var pos: [String: CGPoint] = [:]
        var maxRow = 0
        for n in nodes {
            let c = column(n.type)
            let r = rowInCol[c, default: 0]
            rowInCol[c] = r + 1
            maxRow = max(maxRow, r + 1)
            let x = pad + CGFloat(c) * (nodeW + hGap) + nodeW / 2
            let y = pad + CGFloat(r) * (nodeH + vGap) + nodeH / 2
            pos[n.id] = CGPoint(x: x, y: y)
        }
        let cols = (rowInCol.keys.max() ?? 0) + 1
        let w = pad * 2 + CGFloat(cols) * nodeW + CGFloat(max(cols - 1, 0)) * hGap
        let h = pad * 2 + CGFloat(maxRow) * nodeH + CGFloat(max(maxRow - 1, 0)) * vGap
        return (pos, CGSize(width: max(w, 200), height: max(h, 120)))
    }

    var body: some View {
        let l = layout
        ZStack(alignment: .topLeading) {
            // Edges behind nodes.
            Path { p in
                for e in edges {
                    guard let a = l.positions[e.from], let b = l.positions[e.to] else { continue }
                    p.move(to: CGPoint(x: a.x + nodeW / 2, y: a.y))
                    p.addLine(to: CGPoint(x: b.x - nodeW / 2, y: b.y))
                }
            }
            .stroke(Color.secondary.opacity(0.4), lineWidth: 1)

            ForEach(nodes) { node in
                if let c = l.positions[node.id] {
                    NodeView(node: node, width: nodeW, height: nodeH)
                        .position(c)
                        .onTapGesture { onTap?(node.id) }
                }
            }
        }
        .frame(width: l.size.width, height: l.size.height, alignment: .topLeading)
    }
}

private struct NodeView: View {
    let node: MapNode
    let width: CGFloat
    let height: CGFloat

    private var color: Color {
        switch node.state {
        case .met: return .green
        case .unmet: return .orange
        case .active: return .blue
        case .bugged: return .red
        case .neutral: return .gray
        }
    }

    var body: some View {
        HStack(spacing: 6) {
            // Per-loop hue band (growth ring) when a loop added this node.
            if let loopId = node.loopId {
                Rectangle()
                    .fill(Color(hue: Double(hueForLoop(loopId)) / 360, saturation: 0.7, brightness: 0.55))
                    .frame(width: 4)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(node.type.rawValue).font(.system(size: 8)).foregroundStyle(.secondary)
                Text(node.label).font(.caption2).lineLimit(2).foregroundStyle(.primary)
            }
            Spacer(minLength: 0)
        }
        .padding(.trailing, 6)
        .frame(width: width, height: height, alignment: .leading)
        .background(color.opacity(0.16))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(color.opacity(0.6), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .opacity(node.done ? 0.5 : 1)
    }
}
