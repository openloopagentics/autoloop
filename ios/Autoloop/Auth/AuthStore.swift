import Foundation
import FirebaseAuth
import FirebaseCore
import FirebaseFirestore
import GoogleSignIn
import UIKit

@MainActor
final class AuthStore: ObservableObject {
    @Published private(set) var state: AccessState = .loading
    @Published private(set) var user: AccessUser?
    @Published private(set) var isAdmin = false
    @Published var signInError: String?

    private var authResolved = false
    private var userDocResolved = false
    private var isAllowed = false
    private var authHandle: AuthStateDidChangeListenerHandle?
    private var docListener: ListenerRegistration?

    init() { listen() }

    private func recompute() {
        state = deriveAccess(.init(authResolved: authResolved, user: user,
                                   userDocResolved: userDocResolved, isAllowed: isAllowed))
    }

    private func listen() {
        // Firebase may be unconfigured (no GoogleService-Info.plist in CI / unit-test
        // hosting). Auth.auth() hard-crashes in that case, so resolve to signed-out
        // and skip attaching listeners — mirrors the AppDelegate configure() guard.
        // In a real app run this branch should never execute; fail loud if it does so a
        // misconfiguration surfaces instead of masquerading as a silent "signed-out".
        guard FirebaseApp.app() != nil else {
            if !isRunningUnitTests {
                assertionFailure("FirebaseApp not configured before AuthStore — check AppDelegate.")
            }
            authResolved = true
            recompute()
            return
        }
        authHandle = Auth.auth().addStateDidChangeListener { [weak self] _, u in
            // Firebase may call this off the main actor; hop on.
            Task { @MainActor in
                guard let self else { return }
                self.docListener?.remove(); self.docListener = nil
                self.userDocResolved = false; self.isAllowed = false; self.isAdmin = false
                self.authResolved = true
                guard let u else { self.user = nil; self.recompute(); return }
                self.user = AccessUser(uid: u.uid, email: u.email)
                self.recompute()
                self.docListener = Firestore.firestore().collection("users").document(u.uid)
                    .addSnapshotListener { [weak self] snap, _ in
                        Task { @MainActor in
                            guard let self else { return }
                            let data = snap?.data() ?? [:]
                            self.isAllowed = (data["isAllowed"] as? Bool) == true
                            self.isAdmin = (data["isAdmin"] as? Bool) == true
                            self.userDocResolved = true
                            self.recompute()
                        }
                    }
            }
        }
    }

    func signIn() async {
        signInError = nil
        guard let clientID = FirebaseApp.app()?.options.clientID,
              let root = Self.topViewController() else {
            signInError = "Sign-in is unavailable right now."
            return
        }
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
        do {
            let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: root)
            guard let idToken = result.user.idToken?.tokenString else {
                signInError = "Sign-in is unavailable right now."
                return
            }
            let cred = GoogleAuthProvider.credential(withIDToken: idToken,
                                                     accessToken: result.user.accessToken.tokenString)
            try await Auth.auth().signIn(with: cred)
        } catch let e as NSError {
            if e.code == GIDSignInError.canceled.rawValue { return } // swallow cancel, like the web
            signInError = e.localizedDescription
        }
    }

    func signOut() {
        try? Auth.auth().signOut()
        GIDSignIn.sharedInstance.signOut()
    }

    /// Finds the top-most view controller to present the Google sign-in sheet from.
    @MainActor
    static func topViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        var top = scene?.windows.first(where: { $0.isKeyWindow })?.rootViewController
            ?? scene?.windows.first?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}
