import SwiftUI

struct ThemeOption: Identifiable, Equatable {
    let id: String; let label: String; let swatch: Color
}

let THEMES: [ThemeOption] = [
    .init(id: "dark",     label: "Espresso", swatch: Color(hex: 0xb89058)),
    .init(id: "light",    label: "Daylight", swatch: Color(hex: 0x2563eb)),
    .init(id: "midnight", label: "Midnight", swatch: Color(hex: 0x4db5e8)),
    .init(id: "forest",   label: "Forest",   swatch: Color(hex: 0x5fb87a)),
    .init(id: "nord",     label: "Nord",     swatch: Color(hex: 0x88c0d0)),
    .init(id: "rose",     label: "Rosé",     swatch: Color(hex: 0xd98bb0)),
]

private let THEME_KEY = "autoloop-theme"
private let DEFAULT_THEME = "dark"

final class ThemeStore: ObservableObject {
    private let defaults: UserDefaults
    @Published private(set) var current: ThemeOption

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let saved = defaults.string(forKey: THEME_KEY)
        self.current = THEMES.first { $0.id == saved } ?? THEMES.first { $0.id == DEFAULT_THEME }!
    }

    func select(_ id: String) {
        guard let t = THEMES.first(where: { $0.id == id }) else { return }
        current = t
        defaults.set(id, forKey: THEME_KEY)
    }

    /// The full design-system palette for the active theme.
    var palette: Palette { .named(current.id) }
    /// Drives `preferredColorScheme` so system chrome (status bar, controls) matches.
    var colorScheme: ColorScheme { palette.isDark ? .dark : .light }
}

extension Color {
    init(hex: UInt32) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xff) / 255,
                  green: Double((hex >> 8) & 0xff) / 255,
                  blue: Double(hex & 0xff) / 255)
    }
}
