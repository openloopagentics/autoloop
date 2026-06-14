import Foundation

// MARK: - Slug helpers
// Ported from VisionEditableSection.tsx (slugify/genId) and ScenarioForm.tsx.

/// Lowercase, trim, replace runs of chars NOT in [a-z0-9._-] with "-",
/// strip leading/trailing "-". Matches the web regex:
///   s.toLowerCase().trim().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
func slugify(_ s: String) -> String {
    let lower = s.lowercased().trimmingCharacters(in: .whitespaces)
    // Replace runs of characters outside [a-z0-9._-] with a single "-"
    let pattern = try! NSRegularExpression(pattern: "[^a-z0-9._-]+")
    let range = NSRange(lower.startIndex..., in: lower)
    let dashed = pattern.stringByReplacingMatches(in: lower, range: range, withTemplate: "-")
    // Strip leading and trailing "-"
    return dashed.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
}

/// Produce a valid, non-colliding id from a title, falling back to prefix.
/// Mirrors genId() in VisionEditableSection.tsx.
func genId(title: String, taken: [String], prefix: String) -> String {
    let takenSet = Set(taken)
    let base = slugify(title).isEmpty ? prefix : slugify(title)
    var id = base
    var n = 2
    while takenSet.contains(id) {
        id = "\(base)-\(n)"
        n += 1
    }
    return id
}

/// Returns true if s is non-empty and matches ^[a-z0-9._-]+$
func isValidSlug(_ s: String) -> Bool {
    let trimmed = s.trimmingCharacters(in: .whitespaces)
    guard !trimmed.isEmpty else { return false }
    let pattern = try! NSRegularExpression(pattern: "^[a-z0-9._-]+$")
    let range = NSRange(trimmed.startIndex..., in: trimmed)
    return pattern.firstMatch(in: trimmed, range: range) != nil
}

// MARK: - Criterion row (UI input model)

/// Mirrors the CriterionRow interface in ScenarioForm.tsx.
/// Fields are Strings because they come from text inputs.
struct CriterionRow {
    var name: String
    var weight: String
    var max: String
}

/// Returns true when the row has a non-empty name, weight > 0, and max >= 1.
func rowIsValid(_ r: CriterionRow) -> Bool {
    let nameOk = !r.name.trimmingCharacters(in: .whitespaces).isEmpty
    guard nameOk else { return false }
    guard let w = Double(r.weight), w > 0 else { return false }
    guard let m = Int(r.max), m >= 1 else { return false }
    return true
}

/// Convert CriterionRows to RubricCriterion model values, generating de-duped ids.
/// Mirrors buildCriteria() in ScenarioForm.tsx.
func buildRubricCriteria(_ rows: [CriterionRow]) -> [RubricCriterion] {
    var seen = Set<String>()
    return rows.enumerated().map { (i, r) in
        var id = slugify(r.name)
        if id.isEmpty { id = "c\(i + 1)" }
        while seen.contains(id) { id = "\(id)-\(i + 1)" }
        seen.insert(id)
        let weight = Double(r.weight) ?? 0
        let max = Double(r.max) ?? 0
        return RubricCriterion(id: id, name: r.name.trimmingCharacters(in: .whitespaces),
                               weight: weight, max: max)
    }
}
