import SwiftUI
struct ErrorNote: View {
    let message: String
    var body: some View {
        Text(message)
            .font(.footnote).foregroundStyle(.red)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
    }
}
