import SwiftUI

struct LoopsTabView: View {
    @ObservedObject var store: ProjectDetailStore
    var body: some View {
        Text("Loops").frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
