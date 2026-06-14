import Foundation
import FirebaseFirestore

extension Dictionary where Key == String, Value == Any {
    func str(_ k: String) -> String? { self[k] as? String }
    func bool(_ k: String) -> Bool? { self[k] as? Bool }
    func int(_ k: String) -> Int? {
        if let i = self[k] as? Int { return i }
        if let n = self[k] as? NSNumber { return n.intValue }
        return nil
    }
    func double(_ k: String) -> Double? {
        if let d = self[k] as? Double { return d }
        if let n = self[k] as? NSNumber { return n.doubleValue }
        return nil
    }
    /// Firestore Timestamp -> Date (the loose `unknown` time fields in types.ts).
    func date(_ k: String) -> Date? { (self[k] as? Timestamp)?.dateValue() }
}
