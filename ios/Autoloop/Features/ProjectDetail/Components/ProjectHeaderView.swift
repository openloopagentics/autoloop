import SwiftUI

/// Mirrors ProjectHeader.tsx: title, slug chip, status badge, and the design doc
/// (URL → link; markdown → rendered; nil → nothing).
struct ProjectHeaderView: View {
    let project: Project
    let status: String?

    private var shown: String? { status ?? project.status }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(project.title ?? project.slug)
                        .font(.title2).fontWeight(.semibold)
                    Text(project.slug)
                        .font(.caption.monospaced())
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color.secondary.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                }
                Spacer()
                if let shown { StatusBadge(status: shown) }
            }

            if let design = project.design {
                if design.format == "url", let url = URL(string: design.content) {
                    Link(destination: url) {
                        HStack(spacing: 6) {
                            Image(systemName: "link")
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Design doc").font(.caption.weight(.medium))
                                Text(design.content).font(.caption2.monospaced())
                                    .foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.secondary.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                } else {
                    MarkdownView(text: design.content)
                }
            }
        }
        .padding(.horizontal)
        .padding(.top, 8)
    }
}
