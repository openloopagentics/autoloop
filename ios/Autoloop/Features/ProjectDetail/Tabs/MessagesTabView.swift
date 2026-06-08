import SwiftUI

struct MessagesTabView: View {
    @ObservedObject var store: ProjectDetailStore
    var body: some View {
        Text("Messages").frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
