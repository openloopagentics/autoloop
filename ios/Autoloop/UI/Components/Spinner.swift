import SwiftUI

struct Spinner: View {
    @Environment(\.palette) private var palette
    var label: String = "Connecting to the live board…"
    var body: some View {
        VStack(spacing: 12) {
            ProgressView().tint(palette.accent)
            Text(label).font(.system(size: 13)).foregroundStyle(palette.fgMeta)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .appBackground(palette)
    }
}
