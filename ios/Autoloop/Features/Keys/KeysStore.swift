import Foundation

@MainActor
final class KeysStore: ObservableObject, LoadingStore {
    @Published var keys: [KeyMeta] = []
    @Published var loading = true
    @Published var error: String?
    @Published var revealedKey: String?
    @Published var pending = false

    func refresh() async {
        await runLoad { self.keys = try await RestClient.listKeys() }
    }

    func mint(label: String) async {
        pending = true
        await run {
            self.revealedKey = try await RestClient.mintKey(label: label).key
            await self.refresh()
        }
        pending = false
    }

    func revoke(id: String) async {
        await run {
            try await RestClient.revokeKey(id: id)
            await self.refresh()
        }
    }
}
