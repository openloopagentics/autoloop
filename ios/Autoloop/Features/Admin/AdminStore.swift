import Foundation

@MainActor
final class AdminStore: ObservableObject {
    @Published var users: [AdminUser] = []
    @Published var requests: [AccessRequest] = []
    @Published var loading = true
    @Published var error: String?

    func refresh() async {
        loading = true
        do {
            async let fetchedUsers = RestClient.listUsers()
            async let fetchedRequests = RestClient.listAccessRequests()
            users = try await fetchedUsers
            requests = try await fetchedRequests
            error = nil
        } catch let e {
            error = e.localizedDescription
        }
        loading = false
    }

    func grant(uid: String, email: String) async {
        do {
            let emailArg: String? = email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : email
            try await RestClient.setAllowed(uid: uid, isAllowed: true, email: emailArg)
            await refresh()
        } catch let e {
            error = e.localizedDescription
        }
    }

    func decide(uid: String, approve: Bool) async {
        do {
            try await RestClient.decideAccessRequest(uid: uid, decision: approve ? "approve" : "deny")
            await refresh()
        } catch let e {
            error = e.localizedDescription
        }
    }

    func toggle(uid: String, isAllowed: Bool) async {
        do {
            try await RestClient.setAllowed(uid: uid, isAllowed: isAllowed)
            await refresh()
        } catch let e {
            error = e.localizedDescription
        }
    }
}
