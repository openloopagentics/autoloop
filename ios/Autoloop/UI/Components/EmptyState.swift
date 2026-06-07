import SwiftUI
struct EmptyState: View {
    let text: String
    var body: some View {
        VStack { Text(text).foregroundStyle(.secondary) }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
