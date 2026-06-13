import Foundation

/// Pure verification-verdict logic — mirrors web verificationView.ts.

/// Minimal projection of a Verification for verdict selection (testable without Firestore).
struct VerificationRec: Identified {
    var id: String
    var scenarioId: String? = nil
    var testRunId: String? = nil
    var verdict: String? = nil   // "confirmed" | "refuted"
}

/// Verdict of the latest (highest ULID id) verification targeting this test-run; nil when unverified.
func verdictForTestRun(_ testRunId: String, _ verifications: [VerificationRec]) -> String? {
    latestById(verifications.filter { $0.testRunId == testRunId })?.verdict
}

/// Scenario-level badge verdict: the verdict for the scenario's LATEST test-run. A verification of
/// an older run does not count — only the latest run's evidence matters.
func scenarioVerification(_ scenarioId: String, latestTestRunId: String?, _ verifications: [VerificationRec]) -> String? {
    guard let latestTestRunId else { return nil }
    return verdictForTestRun(latestTestRunId, verifications.filter { $0.scenarioId == scenarioId })
}

extension Verification {
    var asRec: VerificationRec { VerificationRec(id: id, scenarioId: scenarioId, testRunId: testRunId, verdict: verdict) }
}
