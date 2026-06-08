import SwiftUI

/// Tappable, horizontally scrollable tab strip kept two-way in sync with the pager.
struct TabStrip: View {
    @Binding var selection: ProjectDetailTab
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 18) {
                    ForEach(ProjectDetailTab.allCases) { t in
                        Button { withAnimation { selection = t } } label: {
                            Text(t.title)
                                .fontWeight(selection == t ? .semibold : .regular)
                                .foregroundStyle(selection == t ? Color.primary : .secondary)
                        }
                        .id(t)
                    }
                }.padding(.horizontal).padding(.vertical, 8)
            }
            .onChange(of: selection) { new in withAnimation { proxy.scrollTo(new, anchor: .center) } }
        }
    }
}
