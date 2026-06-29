import Foundation

// Pure, network-free helpers backing RestClient's retry + token-cache behaviour.
// Kept Foundation-only (no Firebase) so the classification/backoff/expiry logic is
// unit-testable without a signed-in user or a live socket.

// MARK: - Retry policy

enum RetryPolicy {
    /// Total attempts (initial try + retries). 3 → up to two backed-off retries.
    static let maxAttempts = 3
    /// First backoff step; doubles each attempt → 0.5s, 1s, 2s.
    static let baseDelay: TimeInterval = 0.5

    /// Transient HTTP statuses worth retrying: 429 (rate limit) and any 5xx.
    /// Other 4xx are caller errors and must never be retried.
    static func isRetryable(statusCode: Int) -> Bool {
        statusCode == 429 || (500..<600).contains(statusCode)
    }

    /// Transient network failures worth retrying (timeouts, dropped/absent
    /// connections, DNS/TLS hiccups). Anything else (e.g. .badURL, .cancelled)
    /// is not retried.
    static func isRetryable(urlError: URLError) -> Bool {
        switch urlError.code {
        case .timedOut, .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed,
             .networkConnectionLost, .notConnectedToInternet, .resourceUnavailable,
             .secureConnectionFailed:
            return true
        default:
            return false
        }
    }

    /// Only idempotent methods are retried on transient failure, so a retry can
    /// never duplicate a non-idempotent write (POST mint-key, POST message, …).
    /// PUT upserts and DELETEs are idempotent and safe to repeat.
    static func isIdempotent(method: String) -> Bool {
        switch method.uppercased() {
        case "GET", "PUT", "DELETE", "HEAD", "OPTIONS": return true
        default: return false   // POST, PATCH
        }
    }

    /// Exponential backoff for a zero-based attempt index: 0.5s, 1s, 2s, …
    static func backoffDelay(attempt: Int) -> TimeInterval {
        baseDelay * pow(2.0, Double(max(0, attempt)))
    }

    /// `backoffDelay` expressed in nanoseconds for `Task.sleep(nanoseconds:)`.
    static func backoffNanos(attempt: Int) -> UInt64 {
        UInt64(backoffDelay(attempt: attempt) * 1_000_000_000)
    }
}

// MARK: - Cached token bookkeeping

/// A bearer token plus the instant it was fetched. Holds no clock of its own —
/// the caller passes `now`, which keeps the freshness check a pure function.
struct CachedToken {
    let value: String
    let fetchedAt: Date

    /// Still usable if it was fetched within the last `ttl` seconds.
    func isFresh(ttl: TimeInterval, now: Date) -> Bool {
        now.timeIntervalSince(fetchedAt) < ttl
    }
}
