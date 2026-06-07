import SwiftUI
import FirebaseCore
import GoogleSignIn

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ app: UIApplication,
                     didFinishLaunchingWithOptions opts: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Guard against missing GoogleService-Info.plist (e.g. in test environments / CI
        // before the real plist is wired in). FirebaseApp.configure() hard-crashes if the
        // file is absent, so we skip it safely there. In a real app run the plist MUST be
        // present — fail loud so a packaging/config mistake surfaces instead of silently
        // degrading to a dead sign-in screen.
        if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
            FirebaseApp.configure()
        } else if !isRunningUnitTests {
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
