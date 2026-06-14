import SwiftUI

/// Tappable, horizontally scrollable tab strip kept two-way in sync with the pager.
/// Mirrors the web `.tabbar`: a baseline border with a gold underline under the active tab.
struct TabStrip: View {
    @Environment(\.palette) private var palette
    @Binding var selection: ProjectDetailTab
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    ForEach(ProjectDetailTab.allCases) { t in
                        let active = selection == t
                        Button { withAnimation { selection = t } } label: {
                            Text(t.title)
                                .font(.system(size: 14, weight: active ? .semibold : .regular))
                                .foregroundStyle(active ? palette.fg : palette.fgSoft)
                                .padding(.horizontal, 12).padding(.vertical, 9)
                                .overlay(alignment: .bottom) {
                                    Rectangle()
                                        .fill(active ? palette.accent : .clear)
                                        .frame(height: 2)
                                        .padding(.horizontal, 12)
                                }
                        }
                        .id(t)
                    }
                }.padding(.horizontal, 8)
            }
            .background(alignment: .bottom) { Rectangle().fill(palette.borderSoft).frame(height: 1) }
            .onChange(of: selection) { new in withAnimation { proxy.scrollTo(new, anchor: .center) } }
        }
    }
}
