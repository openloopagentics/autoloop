import SwiftUI

/// Mirrors DocumentsSection row in DocumentsSection.tsx.
/// format=="url" → title as tappable link + url subtitle.
/// other formats → title + MarkdownView of content.
struct DocumentRow: View {
    let document: DocumentRec

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                titleView
                Spacer(minLength: 8)
                if let kind = document.kind {
                    Text(kind)
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color(.systemGray5))
                        .foregroundStyle(.secondary)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                }
            }

            bodyView
        }
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    // MARK: - Sub-views

    @ViewBuilder
    private var titleView: some View {
        if document.format == "url", let urlString = document.content,
           let url = URL(string: urlString) {
            Link(document.title ?? document.id, destination: url)
                .font(.subheadline.bold())
        } else {
            Text(document.title ?? document.id)
                .font(.subheadline.bold())
        }
    }

    @ViewBuilder
    private var bodyView: some View {
        if document.format == "url" {
            if let url = document.content {
                Text(url)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        } else if document.format == "json" {
            // JSON documents render as a preformatted code block, not markdown.
            if let content = document.content, !content.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(content)
                        .font(.caption.monospaced())
                        .textSelection(.enabled)
                }
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        } else if let content = document.content, !content.isEmpty {
            MarkdownView(text: content)
        }
    }
}
