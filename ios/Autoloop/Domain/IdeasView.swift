import Foundation

/// Pure idea ordering/reordering logic — mirrors web ideasView.ts.

/// Band ranks: the user's queue first, then the loop's proposals, then the vetoed, then the shipped.
private let IDEA_BAND: [String: Int] = ["accepted": 0, "proposed": 1, "rejected": 2, "done": 3]

/// Minimal projection of an Idea for sorting/reordering (testable without Firestore).
struct IdeaRec: Identified {
    var id: String
    var status: String? = nil
    var order: Int? = nil
    var createdAt: Date? = nil
}

private func bandRank(_ status: String?) -> Int { IDEA_BAND[status ?? "proposed"] ?? 9 }
private func ideaMillis(_ d: Date?) -> Double { d.map { $0.timeIntervalSince1970 * 1000 } ?? .greatestFiniteMagnitude }

/// Band-sort: accepted → proposed → rejected → done, then order, then createdAt. Pure; does not mutate.
/// (Final id tie-break keeps the order deterministic where the web relies on a stable sort.)
func sortIdeas(_ ideas: [IdeaRec]) -> [IdeaRec] {
    ideas.sorted { a, b in
        let ba = bandRank(a.status), bb = bandRank(b.status)
        if ba != bb { return ba < bb }
        let oa = a.order ?? 0, ob = b.order ?? 0
        if oa != ob { return oa < ob }
        let ma = ideaMillis(a.createdAt), mb = ideaMillis(b.createdAt)
        if ma != mb { return ma < mb }
        return a.id < b.id
    }
}

/// The PUT writes needed to move `id` one step up/down WITHIN its status band.
/// When the band has duplicate orders (e.g. several CLI defaults of 100), the whole band is
/// renumbered 10, 20, 30, … before the swap, so reorder is never a silent no-op. Returns [] at a
/// band edge or for an unknown id. Emits only changed orders.
func moveIdea(_ ideas: [IdeaRec], id: String, dir: MoveDir) -> [(id: String, order: Int)] {
    guard let me = ideas.first(where: { $0.id == id }) else { return [] }
    let band = sortIdeas(ideas).filter { ($0.status ?? "proposed") == (me.status ?? "proposed") }
    guard let idx = band.firstIndex(where: { $0.id == id }) else { return [] }
    let j = dir == .up ? idx - 1 : idx + 1
    if j < 0 || j >= band.count { return [] }
    let orders = band.map { $0.order ?? 0 }
    let hasTies = Set(orders).count != orders.count
    var next = band.enumerated().map { (k, it) in (id: it.id, order: hasTies ? (k + 1) * 10 : (it.order ?? 0)) }
    // Swap only the order VALUES between the two positions.
    let tmp = next[idx].order; next[idx].order = next[j].order; next[j].order = tmp
    return next.enumerated().compactMap { (k, w) in w.order != (band[k].order ?? 0) ? w : nil }
}

enum MoveDir { case up, down }

/// Derive an ideaId from a title: slugify, then append a short random suffix on collision.
func ideaIdFor(_ title: String, taken: Set<String>,
               rand: () -> String = { randomIdSuffix() }) -> String {
    var slug = title.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
    slug = slug.replacingOccurrences(of: "[^a-z0-9._-]+", with: "-", options: .regularExpression)
    slug = slug.replacingOccurrences(of: "^[-.]+|[-.]+$", with: "", options: .regularExpression)
    if slug.isEmpty { slug = "idea" }
    return taken.contains(slug) ? "\(slug)-\(rand())" : slug
}

func randomIdSuffix() -> String {
    let chars = Array("abcdefghijklmnopqrstuvwxyz0123456789")
    return String((0..<4).map { _ in chars.randomElement()! })
}

extension Idea {
    var asRec: IdeaRec { IdeaRec(id: id, status: status, order: order, createdAt: createdAt) }
}
