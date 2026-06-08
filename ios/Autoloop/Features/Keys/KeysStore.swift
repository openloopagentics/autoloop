import Foundation

@MainActor
final class KeysStore: ObservableObject {
    @Published var keys: [KeyMeta] = []
    @Published var loading = true
    @Published var error: String?
    @Published var revealedKey: String?
    @Published var pending = false

    func refresh() async {
        loading = true
        do {
            keys = try await RestClient.listKeys()
            error = nil
        } catch let e {
            error = e.localizedDescription
        }
        loading = false
    }

    func mint(label: String) async {
        pending = true
        do {
            revealedKey = try await RestClient.mintKey(label: label).key
            await refresh()
        } catch let e {
            error = e.localizedDescription
        }
        pending = false
    }

    func revoke(id: String) async {
        do {
            try await RestClient.revokeKey(id: id)
            await refresh()
        } catch let e {
            error = e.localizedDescription
        }
    }
}
