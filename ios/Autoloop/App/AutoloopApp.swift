import SwiftUI
import FirebaseCore
import GoogleSignIn

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ app: UIApplication,
                     didFinishLaunchingWithOptions opts: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Unit tests never initialize Firebase: the host app launches under XCTest, and CI
        // ships only a placeholder GoogleService-Info.plist (the real one is gitignored).
        // Skipping configure() here keeps tests independent of Firebase credentials.
        // In a real app run the plist MUST be present — fail loud so a packaging/config
        // mistake surfaces instead of silently degrading to a dead sign-in screen.
        if isRunningUnitTests {
            // no-op
        } else if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
            FirebaseApp.configure()
        } else {
            assertionFailure("GoogleService-Info.plist missing — Firebase was not configured.")
        }
        return true
    }
}

@main
struct AutoloopApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var auth = AuthStore()
    @StateObject private var theme = ThemeStore()
    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(auth)
                .environmentObject(theme)
                // Complete the Google OAuth callback (the redirect back into the app).
                .onOpenURL { GIDSignIn.sharedInstance.handle($0) }
        }
    }
}
