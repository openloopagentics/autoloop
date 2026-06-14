import SwiftUI

/// The Autoloop design system — a 1:1 port of the web CSS tokens (warm editorial "ops board":
/// espresso surfaces, gold brand, calm 7-color status palette). One `Palette` per theme id.

struct Palette {
    let surface, surfaceRaised, surfaceDeep, surfaceHover, surfaceInset: Color
    let border, borderSoft, borderStrong: Color
    let fg, fgBody, fgSoft, fgMeta, fgFaint: Color
    let accent, accentSoft: Color
    let stQueued, stRunning, stBlocked, stPaused, stCompleted, stFailed, stCancelled: Color
    let isDark: Bool

    /// Exact web status color for a status string (falls back to a muted meta tone).
    func statusColor(_ status: String) -> Color {
        switch status {
        case "queued": return stQueued
        case "running": return stRunning
        case "blocked": return stBlocked
        case "paused": return stPaused
        case "completed": return stCompleted
        case "failed": return stFailed
        case "cancelled": return stCancelled
        default: return fgMeta
        }
    }
}

extension Palette {
    static let dark = Palette(
        surface: .h(0x1c1912), surfaceRaised: .h(0x232016), surfaceDeep: .h(0x141210),
        surfaceHover: .h(0x2a2517), surfaceInset: .h(0x18150f),
        border: .h(0x3a3428), borderSoft: .h(0x2c2820), borderStrong: .h(0x4a4035),
        fg: .h(0xf2ece0), fgBody: .h(0xd4c9b4), fgSoft: .h(0x9a8f7a), fgMeta: .h(0x6a6055), fgFaint: .h(0x4a4540),
        accent: .h(0xb89058), accentSoft: .h(0x4a3820),
        stQueued: .h(0x868ea2), stRunning: .h(0xcda85f), stBlocked: .h(0xd18a55), stPaused: .h(0x9d92a8),
        stCompleted: .h(0x88a571), stFailed: .h(0xc5685d), stCancelled: .h(0x7c7264), isDark: true)

    static let light = Palette(
        surface: .h(0xffffff), surfaceRaised: .h(0xffffff), surfaceDeep: .h(0xf9fafb),
        surfaceHover: .h(0xf3f4f6), surfaceInset: .h(0xf9fafb),
        border: .h(0xe5e7eb), borderSoft: .h(0xf3f4f6), borderStrong: .h(0xd1d5db),
        fg: .h(0x111827), fgBody: .h(0x374151), fgSoft: .h(0x6b7280), fgMeta: .h(0x9ca3af), fgFaint: .h(0xd1d5db),
        accent: .h(0x2563eb), accentSoft: .h(0xdbe5fb),
        stQueued: .h(0x5f6678), stRunning: .h(0xa87d2c), stBlocked: .h(0xb5642f), stPaused: .h(0x756a82),
        stCompleted: .h(0x4d7a3b), stFailed: .h(0xb0433a), stCancelled: .h(0x6b6258), isDark: false)

    static let midnight = Palette(
        surface: .h(0x0f1420), surfaceRaised: .h(0x161d2e), surfaceDeep: .h(0x0a0e17),
        surfaceHover: .h(0x1c2438), surfaceInset: .h(0x11161f),
        border: .h(0x283145), borderSoft: .h(0x1d2536), borderStrong: .h(0x3a4763),
        fg: .h(0xe6ecf5), fgBody: .h(0xc2ccdc), fgSoft: .h(0x8a94a8), fgMeta: .h(0x5f6878), fgFaint: .h(0x3a4356),
        accent: .h(0x4db5e8), accentSoft: .h(0x163040),
        stQueued: .h(0x868ea2), stRunning: .h(0xcda85f), stBlocked: .h(0xd18a55), stPaused: .h(0x9d92a8),
        stCompleted: .h(0x88a571), stFailed: .h(0xc5685d), stCancelled: .h(0x7c7264), isDark: true)

    static let forest = Palette(
        surface: .h(0x11201a), surfaceRaised: .h(0x16291f), surfaceDeep: .h(0x0c1812),
        surfaceHover: .h(0x1b3326), surfaceInset: .h(0x0f1d16),
        border: .h(0x2a4133), borderSoft: .h(0x1f3327), borderStrong: .h(0x38543f),
        fg: .h(0xe8f0e8), fgBody: .h(0xc4d4c4), fgSoft: .h(0x8ba189), fgMeta: .h(0x5f7560), fgFaint: .h(0x3c4f3e),
        accent: .h(0x5fb87a), accentSoft: .h(0x1c3a26),
        stQueued: .h(0x868ea2), stRunning: .h(0xcda85f), stBlocked: .h(0xd18a55), stPaused: .h(0x9d92a8),
        stCompleted: .h(0x88a571), stFailed: .h(0xc5685d), stCancelled: .h(0x7c7264), isDark: true)

    static let nord = Palette(
        surface: .h(0x2e3440), surfaceRaised: .h(0x3b4252), surfaceDeep: .h(0x272c36),
        surfaceHover: .h(0x434c5e), surfaceInset: .h(0x2b313c),
        border: .h(0x434c5e), borderSoft: .h(0x3b4252), borderStrong: .h(0x4c566a),
        fg: .h(0xeceff4), fgBody: .h(0xd8dee9), fgSoft: .h(0xa9b3c4), fgMeta: .h(0x7b8494), fgFaint: .h(0x4c566a),
        accent: .h(0x88c0d0), accentSoft: .h(0x2c3a40),
        stQueued: .h(0x97a0b4), stRunning: .h(0xebcb8b), stBlocked: .h(0xd08770), stPaused: .h(0xb48ead),
        stCompleted: .h(0xa3be8c), stFailed: .h(0xbf616a), stCancelled: .h(0x7c8494), isDark: true)

    static let rose = Palette(
        surface: .h(0x1f1a22), surfaceRaised: .h(0x2a232e), surfaceDeep: .h(0x181319),
        surfaceHover: .h(0x322839), surfaceInset: .h(0x1c161f),
        border: .h(0x3a2f40), borderSoft: .h(0x2c2531), borderStrong: .h(0x4d3f54),
        fg: .h(0xefe6f0), fgBody: .h(0xd2c4d4), fgSoft: .h(0xa08fa6), fgMeta: .h(0x6f6075), fgFaint: .h(0x463a4c),
        accent: .h(0xd98bb0), accentSoft: .h(0x3a2433),
        stQueued: .h(0x9a8fa6), stRunning: .h(0xd9a85f), stBlocked: .h(0xd18a70), stPaused: .h(0xb48ead),
        stCompleted: .h(0x8fb482), stFailed: .h(0xd2697a), stCancelled: .h(0x7c7080), isDark: true)

    static func named(_ id: String) -> Palette {
        switch id {
        case "light": return .light
        case "midnight": return .midnight
        case "forest": return .forest
        case "nord": return .nord
        case "rose": return .rose
        default: return .dark
        }
    }
}

// MARK: - Spacing / radius tokens (compact density — denser than the web default for phones)

enum DS {
    static let gap: CGFloat = 12
    static let cardPad: CGFloat = 13
    static let rowPad: CGFloat = 9
    static let sectionGap: CGFloat = 18
    static let radius: CGFloat = 12
    static let radiusSm: CGFloat = 8
    static let radiusXs: CGFloat = 4
}

// MARK: - Typography (serif for the editorial wordmark / titles, like the web)

extension Font {
    static func serif(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }
}

// MARK: - Environment

private struct PaletteKey: EnvironmentKey { static let defaultValue = Palette.dark }
extension EnvironmentValues {
    var palette: Palette {
        get { self[PaletteKey.self] }
        set { self[PaletteKey.self] = newValue }
    }
}

// MARK: - Card surface (replaces the generic .regularMaterial)

extension View {
    /// A raised card surface: themed fill + 1px border + rounded corners. No padding (caller owns it).
    func card(_ palette: Palette, cornerRadius: CGFloat = DS.radius) -> some View {
        self
            .background(palette.surfaceRaised)
            .overlay(RoundedRectangle(cornerRadius: cornerRadius).strokeBorder(palette.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
    }

    /// Fill the safe area with the deep app surface (the espresso board).
    func appBackground(_ palette: Palette) -> some View {
        background(palette.surfaceDeep.ignoresSafeArea())
    }

    /// Raised card surface that reads the palette from the environment — a drop-in replacement for
    /// `.cardSurface()` that needs no per-view `@Environment` plumbing.
    func cardSurface(cornerRadius: CGFloat = DS.radius) -> some View {
        modifier(CardSurface(cornerRadius: cornerRadius))
    }
}

private struct CardSurface: ViewModifier {
    @Environment(\.palette) private var palette
    let cornerRadius: CGFloat
    func body(content: Content) -> some View {
        content
            .background(palette.surfaceRaised)
            .overlay(RoundedRectangle(cornerRadius: cornerRadius).strokeBorder(palette.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
    }
}

extension Color {
    /// Hex literal helper (alias of the existing init(hex:)).
    static func h(_ hex: UInt32) -> Color { Color(hex: hex) }
}
