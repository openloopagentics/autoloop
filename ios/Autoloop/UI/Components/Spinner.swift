import SwiftUI

struct Spinner: View {
    var label: String = "Connecting to the live board…"
    var body: some View {
        VStack(spacing: 12) { ProgressView(); Text(label).foregroundStyle(.secondary) }
    }
}
