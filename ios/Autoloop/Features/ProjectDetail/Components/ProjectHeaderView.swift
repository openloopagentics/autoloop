import SwiftUI

/// Mirrors ProjectHeader.tsx: title, slug chip, status badge, and the design doc
/// (URL → link; markdown → rendered; nil → nothing).
struct ProjectHeaderView: View {
    @Environment(\.palette) private var palette
    let project: Project
    let status: String?

    private var shown: String? { status ?? project.status }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(project.title ?? project.slug)
                        .font(.serif(22)).foregroundStyle(palette.fg)
                    Text(project.slug)
                        .font(.caption.monospaced())
                        .foregroundStyle(palette.fgSoft)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(palette.surfaceInset)
                        .clipShape(RoundedRectangle(cornerRadius: DS.radiusXs))
                }
                Spacer()
                if let shown { StatusBadge(status: shown) }
            }

            if let design = project.design {
                if design.format == "url", let url = URL(string: design.content) {
                    Link(destination: url) {
                        HStack(spacing: 6) {
                            Image(systemName: "link").foregroundStyle(palette.accent)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Design doc").font(.caption.weight(.medium)).foregroundStyle(palette.fgBody)
                                Text(design.content).font(.caption2.monospaced())
                                    .foregroundStyle(palette.fgMeta).lineLimit(1)
                            }
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .cardSurface(cornerRadius: DS.radiusSm)
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
