import { buildNavTree, type NavNode } from "./navTree";
import { scenarioStatus, summarize } from "../scenarioState";
import type { Page, PageComment, Scenario, Score, TestRun, Verification } from "../types";

/** Met-count for a single page's scenarios (verification- and blocking-aware). */
function pageMet(page: Page, byId: Map<string, Scenario>, scores: Score[], testRuns: TestRun[], verifications: Verification[], blockedIds?: Set<string>): { met: number; total: number } | null {
  const ids = page.scenarioIds ?? [];
  if (ids.length === 0) return null;
  let met = 0;
  let total = 0;
  for (const id of ids) {
    const s = byId.get(id);
    if (!s) continue;
    total++;
    if (scenarioStatus(s, scores, testRuns, verifications, blockedIds).state === "met") met++;
  }
  return total === 0 ? null : { met, total };
}

function NavTreeNodes({ nodes, selectedPageId, onSelect, pages, byId, scores, testRuns, verifications, blockedIds, depth }: {
  nodes: NavNode[];
  selectedPageId: string | null;
  onSelect: (pageId: string) => void;
  pages: Map<string, Page>;
  byId: Map<string, Scenario>;
  scores: Score[];
  testRuns: TestRun[];
  verifications: Verification[];
  blockedIds?: Set<string>;
  depth: number;
}) {
  return (
    <ul className="wikinav-list" style={{ paddingLeft: depth === 0 ? 0 : 12 }}>
      {nodes.map((node) => {
        const page = node.pageId ? pages.get(node.pageId) : undefined;
        const met = page ? pageMet(page, byId, scores, testRuns, verifications, blockedIds) : null;
        return (
          <li key={node.key} className="wikinav-item">
            {node.pageId ? (
              <button
                type="button"
                className={`wikinav-link${node.pageId === selectedPageId ? " is-selected" : ""}`}
                aria-current={node.pageId === selectedPageId ? "page" : undefined}
                onClick={() => onSelect(node.pageId!)}
              >
                <span className="wikinav-title">{node.title}</span>
                {met && <span className="wikinav-chip tnum">{met.met}/{met.total}</span>}
              </button>
            ) : (
              <span className="wikinav-dir">{node.title}</span>
            )}
            {node.children.length > 0 && (
              <NavTreeNodes nodes={node.children} selectedPageId={selectedPageId} onSelect={onSelect}
                pages={pages} byId={byId} scores={scores} testRuns={testRuns} verifications={verifications}
                blockedIds={blockedIds} depth={depth + 1} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Wiki nav sidebar: a tree of pages (nested by path), a "N of M scenarios met"
 * roll-up, per-page met chips, and a project-level "unanchored comments" section
 * listing open comments whose page no longer exists (the loop deleted the page but
 * the steering note survives). Each is shown with its quoted anchor text.
 * Props-in/render-out.
 */
export function WikiNav({ pages, scenarios, scores, testRuns, verifications, blockedIds, comments, selectedPageId, onSelect }: {
  pages: Page[];
  scenarios: Scenario[];
  scores: Score[];
  testRuns: TestRun[];
  verifications: Verification[];
  blockedIds?: Set<string>;
  comments?: PageComment[];
  selectedPageId: string | null;
  onSelect: (pageId: string) => void;
}) {
  const tree = buildNavTree(pages);
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const { met, total } = summarize(scenarios, scores, testRuns, verifications, blockedIds);

  const livePageIds = new Set(pages.map((p) => p.id));
  const orphaned = (comments ?? []).filter(
    (c) => (c.status ?? "open") === "open" && (!c.pageId || !livePageIds.has(c.pageId)),
  );

  return (
    <nav className="wikinav">
      <div className="wikinav-rollup">
        <span className="tnum">{met}</span> of <span className="tnum">{total}</span> scenarios met
      </div>
      <NavTreeNodes nodes={tree} selectedPageId={selectedPageId} onSelect={onSelect}
        pages={pageById} byId={byId} scores={scores} testRuns={testRuns} verifications={verifications}
        blockedIds={blockedIds} depth={0} />
      {orphaned.length > 0 && (
        <section className="wikinav-unanchored" aria-label="Unanchored comments">
          <h4 className="wikinav-unanchored-head">Unanchored comments</h4>
          <ul className="wikinav-unanchored-list">
            {orphaned.map((c) => (
              <li key={c.id} className="wikinav-unanchored-item">
                {c.anchor?.exact && <span className="wikinav-unanchored-quote">"{c.anchor.exact}"</span>}
                {c.body && <span className="wikinav-unanchored-body">{c.body}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </nav>
  );
}
