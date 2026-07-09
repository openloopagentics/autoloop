import type { Page, PageComment } from "./types";

/**
 * Spec §2: a blocking comment suppresses its target scenario's met state until the
 * loop resolves it AND the author/admin accepts — i.e. blocked iff
 * severity==="blocking" && !(status !== "open" && accepted === true).
 * Target = the stamped targetScenarioId if present, else every scenario on the
 * comment's page (via the page's scenarioIds).
 */
export function blockedScenarioIds(comments: PageComment[], pages: Page[]): Set<string> {
  const byPage = new Map(pages.map((p) => [p.id, p.scenarioIds ?? []]));
  const out = new Set<string>();
  for (const c of comments) {
    if (c.severity !== "blocking") continue;
    if (c.status !== "open" && c.accepted === true) continue;
    const targets = c.targetScenarioId ? [c.targetScenarioId] : (byPage.get(c.pageId ?? "") ?? []);
    for (const id of targets) out.add(id);
  }
  return out;
}
