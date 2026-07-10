import type { Page, PageComment } from "./types";

/**
 * Spec §2 blocking-gate predicate — the SINGLE source of truth (consumed here and by
 * the wiki CommentSidebar): a comment gates iff it is blocking and NOT (closed AND
 * accepted). So an open blocking comment gates, and — note — a resolved-but-unaccepted
 * blocking comment STILL gates; only a closed comment the author/admin has accepted lifts.
 */
export function isBlocking(c: PageComment): boolean {
  return c.severity === "blocking" && !(c.status !== "open" && c.accepted === true);
}

/**
 * Spec §2: a blocking comment suppresses its target scenario's met state until it is
 * resolved AND accepted (see isBlocking). Target = the stamped targetScenarioId if
 * present, else every scenario on the comment's page (via the page's scenarioIds).
 * Compute once per render and pass the set to summarize/scenarioStatus.
 */
export function blockedScenarioIds(comments: PageComment[], pages: Page[]): Set<string> {
  const byPage = new Map(pages.map((p) => [p.id, p.scenarioIds ?? []]));
  const out = new Set<string>();
  for (const c of comments) {
    if (!isBlocking(c)) continue;
    const targets = c.targetScenarioId ? [c.targetScenarioId] : (byPage.get(c.pageId ?? "") ?? []);
    for (const id of targets) out.add(id);
  }
  return out;
}
