import SwiftUI

struct DashboardTabView: View {
    @ObservedObject var store: ProjectDetailStore
    var body: some View {
        Text("Dashboard").frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
