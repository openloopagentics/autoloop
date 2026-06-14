import SwiftUI
struct EmptyState: View {
    @Environment(\.palette) private var palette
    let text: String
    var body: some View {
        VStack { Text(text).font(.system(size: 14)).foregroundStyle(palette.fgMeta) }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(DS.cardPad)
    }
}
