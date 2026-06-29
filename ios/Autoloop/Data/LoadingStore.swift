import Foundation

/// Shared `loading` / `error` plumbing for the request-backed stores that all repeat
/// the same `loading = true; do { … } catch { error = … }; loading = false` triad
/// (KeysStore, AdminStore, …). Conformers keep their own domain `@Published` data
/// properties — only the loading/error bookkeeping is factored out here, so the public
/// names views observe are untouched.
@MainActor
protocol LoadingStore: AnyObject {
    var loading: Bool { get set }
    var error: String? { get set }
}

@MainActor
extension LoadingStore {
    /// Runs `work` as a full load: flips `loading`, clears `error` on success, and
    /// captures any thrown error's description into `error`.
    func runLoad(_ work: () async throws -> Void) async {
        loading = true
        do {
            try await work()
            self.error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    /// Runs `work` as a follow-up action (e.g. a mutation that then refreshes) without
    /// touching `loading`: clears `error` on success, captures it on failure.
    func run(_ work: () async throws -> Void) async {
        do {
            try await work()
            self.error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
