import Foundation

@MainActor
final class AdminStore: ObservableObject, LoadingStore {
    @Published var users: [AdminUser] = []
    @Published var requests: [AccessRequest] = []
    @Published var loading = true
    @Published var error: String?

    func refresh() async {
        await runLoad {
            async let fetchedUsers = RestClient.listUsers()
            async let fetchedRequests = RestClient.listAccessRequests()
            self.users = try await fetchedUsers
            self.requests = try await fetchedRequests
        }
    }

    func grant(uid: String, email: String) async {
        await run {
            let emailArg: String? = email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : email
            try await RestClient.setAllowed(uid: uid, isAllowed: true, email: emailArg)
            await self.refresh()
        }
    }

    func decide(uid: String, approve: Bool) async {
        await run {
            try await RestClient.decideAccessRequest(uid: uid, decision: approve ? "approve" : "deny")
            await self.refresh()
        }
    }

    func toggle(uid: String, isAllowed: Bool) async {
        await run {
            try await RestClient.setAllowed(uid: uid, isAllowed: isAllowed)
            await self.refresh()
        }
    }
}
