import Foundation

enum AccessState { case loading, signedOut, pending, allowed }

struct AccessUser: Equatable { let uid: String; let email: String? }

struct AccessInputs {
    let authResolved: Bool
    let user: AccessUser?
    let userDocResolved: Bool
    let isAllowed: Bool
}

/// Direct port of web/src/auth/gate.ts deriveAccess.
func deriveAccess(_ i: AccessInputs) -> AccessState {
    if !i.authResolved { return .loading }
    guard i.user != nil else { return .signedOut }
    if !i.userDocResolved { return .loading } // flash-prevention
    return i.isAllowed ? .allowed : .pending
}
