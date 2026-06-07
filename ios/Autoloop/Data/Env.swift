import Foundation

/// True when the process is hosting an XCTest run. Used to keep test hosts from
/// tripping production-only "must be configured" assertions (the unit-test host
/// runs without a real GoogleService-Info.plist).
let isRunningUnitTests = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
