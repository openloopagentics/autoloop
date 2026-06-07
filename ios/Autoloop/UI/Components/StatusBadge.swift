import SwiftUI
struct StatusBadge: View {
    let status: String
    private var color: Color {
        switch statusColor(status) {
        case .gray: return .gray; case .blue: return .blue; case .red: return .red
        case .amber: return .orange; case .green: return .green
        }
    }
    var body: some View {
        Text(status).font(.caption).padding(.horizontal, 8).padding(.vertical, 2)
            .background(color.opacity(0.18)).foregroundStyle(color).clipShape(Capsule())
    }
}
