import SwiftUI
import FirebaseCore

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ app: UIApplication,
                     didFinishLaunchingWithOptions opts: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Guard against missing GoogleService-Info.plist (e.g. in test environments / CI
        // before the real plist is wired in Task 9). FirebaseApp.configure() hard-crashes
        // if the file is absent, so we skip it safely here.
        if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
            FirebaseApp.configure()
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
            RootView().environmentObject(auth).environmentObject(theme)
        }
    }
}
