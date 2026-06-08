import SwiftUI

struct VisionTabView: View {
    @ObservedObject var store: ProjectDetailStore
    var body: some View {
        Text("Vision").frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
