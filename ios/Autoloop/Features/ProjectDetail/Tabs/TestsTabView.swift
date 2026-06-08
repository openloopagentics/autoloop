import SwiftUI

struct TestsTabView: View {
    @ObservedObject var store: ProjectDetailStore
    var body: some View {
        Text("Tests").frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
