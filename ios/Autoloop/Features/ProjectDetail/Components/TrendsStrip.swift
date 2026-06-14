import SwiftUI

/// Compact number label: 1234 → "1.2k", 2500000 → "2.5M". Mirrors TrendsStrip.tsx fmt().
func trendFmt(_ n: Double) -> String {
    if abs(n) >= 1e6 { return String(format: "%.1fM", n / 1e6) }
    if abs(n) >= 1e3 { return String(format: "%.1fk", n / 1e3) }
    return n == n.rounded() ? String(Int(n)) : String(format: "%.1f", n)
}

/// Mirrors TrendsStrip.tsx: 4 cross-loop sparklines. Hidden under 2 points (no trend from one);
/// caption labels the bounded window ("last N loops").
struct TrendsStrip: View {
    let points: [TrendPoint]

    var body: some View {
        if points.count >= 2 {
            let latest = points[points.count - 1]
            VStack(alignment: .leading, spacing: 12) {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    Sparkline(label: "Scenarios met",
                              series: points.map { Double($0.metCount) },
                              latest: "\(latest.metCount)/\(latest.scenarioTotal)")
                    Sparkline(label: "Avg composite",
                              series: points.map { $0.avgComposite },
                              latest: latest.avgComposite == nil ? "–" : trendFmt(latest.avgComposite!))
                    Sparkline(label: "Bugs",
                              series: points.map { Double($0.bugsOpened) },
                              series2: points.map { Double($0.bugsFixed) },
                              latest: "\(latest.bugsOpened) open · \(latest.bugsFixed) fixed")
                    Sparkline(label: "Tokens/loop",
                              series: points.map { Double($0.tokensTotal) },
                              latest: trendFmt(Double(latest.tokensTotal)))
                }
                Text("last \(points.count) loops")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            .padding()
            .cardSurface()
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal)
        }
    }
}

private struct Sparkline: View {
    let label: String
    let series: [Double?]
    var series2: [Double?]? = nil
    let latest: String

    private let w: CGFloat = 120, h: CGFloat = 32

    private var minMax: (Double, Double) {
        let nums = (series + (series2 ?? [])).compactMap { $0 }
        guard !nums.isEmpty else { return (0, 0) }
        return (nums.min()!, nums.max()!)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            ZStack {
                line(series, color: .accentColor)
                if let s2 = series2 { line(s2, color: .green) }
            }
            .frame(width: w, height: h)
            HStack {
                Text("\(trendFmt(minMax.0))–\(trendFmt(minMax.1))")
                    .foregroundStyle(.secondary)
                Spacer()
                Text(latest).fontWeight(.medium)
            }
            .font(.caption2.monospacedDigit())
            .frame(width: w)
        }
    }

    private func line(_ values: [Double?], color: Color) -> some View {
        let pts = polylinePoints(values, width: w, height: h)
        return Path { p in
            guard let first = pts.first else { return }
            p.move(to: first)
            for pt in pts.dropFirst() { p.addLine(to: pt) }
        }
        .stroke(color, style: StrokeStyle(lineWidth: 1.5, lineJoin: .round))
    }
}
