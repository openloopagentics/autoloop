import SwiftUI
import MarkdownUI

/// Renders Markdown content (Vision documents / design docs). Wraps swift-markdown-ui
/// so the rest of the app depends on one small surface.
struct MarkdownView: View {
    let text: String
    var body: some View { Markdown(text) }
}
