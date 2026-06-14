import SwiftUI
struct ErrorNote: View {
    @Environment(\.palette) private var palette
    let message: String
    var body: some View {
        Text(message)
            .font(.footnote)
            .foregroundStyle(palette.stFailed)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(DS.cardPad)
            .background(palette.stFailed.opacity(0.10))
            .clipShape(RoundedRectangle(cornerRadius: DS.radiusSm))
    }
}
