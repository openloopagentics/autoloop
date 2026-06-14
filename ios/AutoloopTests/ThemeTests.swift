import XCTest
@testable import Autoloop

final class ThemeTests: XCTestCase {
    private func freshDefaults() -> UserDefaults {
        let d = UserDefaults(suiteName: "theme-test")!
        d.removePersistentDomain(forName: "theme-test")
        return d
    }

    func testDefaultsToDarkWhenUnset() {
        XCTAssertEqual(ThemeStore(defaults: freshDefaults()).current.id, "dark")
    }
    func testPersistsValidSelection() {
        let d = freshDefaults()
        let s = ThemeStore(defaults: d); s.select("forest")
        XCTAssertEqual(ThemeStore(defaults: d).current.id, "forest")
    }
    func testIgnoresUnknownThemeId() {
        let d = freshDefaults(); d.set("not-a-theme", forKey: "autoloop-theme")
        XCTAssertEqual(ThemeStore(defaults: d).current.id, "dark")
    }
    func testSixThemesPresentInOrder() {
        XCTAssertEqual(THEMES.map(\.id), ["dark", "light", "midnight", "forest", "nord", "rose"])
    }
}
