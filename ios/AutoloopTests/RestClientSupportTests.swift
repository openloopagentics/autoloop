import XCTest
@testable import Autoloop

final class RestClientSupportTests: XCTestCase {

    // MARK: - isRetryable(statusCode:)

    func testRetryableStatuses() {
        XCTAssertTrue(RetryPolicy.isRetryable(statusCode: 429))   // rate limit
        XCTAssertTrue(RetryPolicy.isRetryable(statusCode: 500))
        XCTAssertTrue(RetryPolicy.isRetryable(statusCode: 503))
        XCTAssertTrue(RetryPolicy.isRetryable(statusCode: 599))
    }

    func testNonRetryableStatuses() {
        // 4xx (other than 429) are caller errors — never retried.
        XCTAssertFalse(RetryPolicy.isRetryable(statusCode: 400))
        XCTAssertFalse(RetryPolicy.isRetryable(statusCode: 401))
        XCTAssertFalse(RetryPolicy.isRetryable(statusCode: 403))
        XCTAssertFalse(RetryPolicy.isRetryable(statusCode: 404))
        // 2xx/3xx aren't failures.
        XCTAssertFalse(RetryPolicy.isRetryable(statusCode: 200))
        XCTAssertFalse(RetryPolicy.isRetryable(statusCode: 304))
        XCTAssertFalse(RetryPolicy.isRetryable(statusCode: 600))
    }

    // MARK: - isRetryable(urlError:)

    func testRetryableURLErrors() {
        XCTAssertTrue(RetryPolicy.isRetryable(urlError: URLError(.timedOut)))
        XCTAssertTrue(RetryPolicy.isRetryable(urlError: URLError(.networkConnectionLost)))
        XCTAssertTrue(RetryPolicy.isRetryable(urlError: URLError(.notConnectedToInternet)))
        XCTAssertTrue(RetryPolicy.isRetryable(urlError: URLError(.cannotConnectToHost)))
        XCTAssertTrue(RetryPolicy.isRetryable(urlError: URLError(.dnsLookupFailed)))
    }

    func testNonRetryableURLErrors() {
        XCTAssertFalse(RetryPolicy.isRetryable(urlError: URLError(.badURL)))
        XCTAssertFalse(RetryPolicy.isRetryable(urlError: URLError(.cancelled)))
        XCTAssertFalse(RetryPolicy.isRetryable(urlError: URLError(.unsupportedURL)))
    }

    // MARK: - isIdempotent(method:)

    func testIdempotentMethods() {
        XCTAssertTrue(RetryPolicy.isIdempotent(method: "GET"))
        XCTAssertTrue(RetryPolicy.isIdempotent(method: "PUT"))
        XCTAssertTrue(RetryPolicy.isIdempotent(method: "DELETE"))
        XCTAssertTrue(RetryPolicy.isIdempotent(method: "delete"))   // case-insensitive
    }

    func testNonIdempotentMethods() {
        XCTAssertFalse(RetryPolicy.isIdempotent(method: "POST"))
        XCTAssertFalse(RetryPolicy.isIdempotent(method: "PATCH"))
    }

    // MARK: - backoff

    func testBackoffDoubles() {
        XCTAssertEqual(RetryPolicy.backoffDelay(attempt: 0), 0.5, accuracy: 1e-9)
        XCTAssertEqual(RetryPolicy.backoffDelay(attempt: 1), 1.0, accuracy: 1e-9)
        XCTAssertEqual(RetryPolicy.backoffDelay(attempt: 2), 2.0, accuracy: 1e-9)
        XCTAssertEqual(RetryPolicy.backoffDelay(attempt: 3), 4.0, accuracy: 1e-9)
    }

    func testBackoffNanosMatchesSeconds() {
        XCTAssertEqual(RetryPolicy.backoffNanos(attempt: 0), 500_000_000)
        XCTAssertEqual(RetryPolicy.backoffNanos(attempt: 1), 1_000_000_000)
        XCTAssertEqual(RetryPolicy.backoffNanos(attempt: 2), 2_000_000_000)
    }

    // MARK: - CachedToken expiry

    func testCachedTokenFreshWithinTTL() {
        let now = Date()
        let t = CachedToken(value: "abc", fetchedAt: now)
        XCTAssertTrue(t.isFresh(ttl: 300, now: now))                       // same instant
        XCTAssertTrue(t.isFresh(ttl: 300, now: now.addingTimeInterval(299)))
    }

    func testCachedTokenExpiredAtOrAfterTTL() {
        let now = Date()
        let t = CachedToken(value: "abc", fetchedAt: now)
        XCTAssertFalse(t.isFresh(ttl: 300, now: now.addingTimeInterval(300)))   // exactly TTL → stale
        XCTAssertFalse(t.isFresh(ttl: 300, now: now.addingTimeInterval(301)))
    }

    // MARK: - ApiError carries status + body

    func testApiErrorCarriesStatusAndBody() {
        let err = ApiError(message: "boom", statusCode: 503, body: "{\"x\":1}")
        XCTAssertEqual(err.statusCode, 503)
        XCTAssertEqual(err.body, "{\"x\":1}")
        XCTAssertEqual(err.errorDescription, "boom")
    }

    func testApiErrorMessageOnlyInitStillWorks() {
        // Back-compat: TeamActions constructs ApiError(message:) with no status/body.
        let err = ApiError(message: "Not signed in")
        XCTAssertNil(err.statusCode)
        XCTAssertNil(err.body)
        XCTAssertEqual(err.errorDescription, "Not signed in")
    }
}
