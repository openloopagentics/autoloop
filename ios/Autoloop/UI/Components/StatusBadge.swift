import SwiftUI
struct StatusBadge: View {
    @Environment(\.palette) private var palette
    let status: String
    var body: some View {
        let color = palette.statusColor(status)
        Text(status)
            .font(.system(size: 11, weight: .semibold))
            .textCase(.uppercase)
            .tracking(0.5)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.16))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }
}
