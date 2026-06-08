import SwiftUI

struct BugsTabView: View {
    @ObservedObject var store: ProjectDetailStore
    var body: some View {
        Text("Bugs").frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
