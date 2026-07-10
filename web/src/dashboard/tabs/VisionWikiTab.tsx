import { useCallback, useMemo, useState } from "react";
import { WikiNav } from "../wiki/WikiNav";
import { WikiPage, type NewComment } from "../wiki/WikiPage";
import { CommentSidebar } from "../wiki/CommentSidebar";
import { buildNavTree } from "../wiki/navTree";
import { blockedScenarioIds } from "../blockedScenarios";
import { postComment, acceptComment } from "../api";
import type { Page, PageComment, Scenario, Score, TestRun, Verification } from "../types";

/** First page in nav order — reuses the nav tree's ordering rather than reinventing it. */
function firstPageId(pages: Page[]): string | null {
  const walk = (nodes: ReturnType<typeof buildNavTree>): string | null => {
    for (const n of nodes) {
      if (n.pageId) return n.pageId;
      const inner = walk(n.children);
      if (inner) return inner;
    }
    return null;
  };
  return walk(buildNavTree(pages));
}

/**
 * The live wiki: WikiNav (left) + WikiPage (center) + CommentSidebar (right). Owns the
 * selected page and the rendered page's flat text (fed from WikiPage's onPageTextChange —
 * NEVER page.markdown; anchors are built from rendered text). The blocked set is computed
 * once here and shared with nav (roll-up + chips) and page (scenario-card gating); the
 * sidebar shares the isBlocking PREDICATE (not this set) to badge/gate its own threads.
 * Scenario-status props (scores/testRuns/verifications) are plumbed exactly as VisionTab does.
 */
export function VisionWikiTab({ teamId, slug, scenarios, scores, testRuns, verifications, pages, comments, currentUid, isAdmin }: {
  teamId: string; slug: string;
  scenarios: Scenario[]; scores: Score[]; testRuns: TestRun[]; verifications: Verification[];
  pages: Page[]; comments: PageComment[];
  currentUid?: string; isAdmin?: boolean;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  // The rendered flat text tagged with the page it came from. WikiPage reports the new
  // page's text one render AFTER selectedPage flips, so tag-and-match keeps the sidebar
  // from re-locating the incoming page's comments against the outgoing page's text.
  const [rendered, setRendered] = useState<{ pageId: string | null; text: string }>({ pageId: null, text: "" });

  const defaultPageId = useMemo(() => firstPageId(pages), [pages]);
  const selectedPageId = (picked && pages.some((p) => p.id === picked)) ? picked : defaultPageId;
  const selectedPage = pages.find((p) => p.id === selectedPageId) ?? null;

  // Compute the blocked set ONCE and pass it to nav, page, and sidebar (via CommentSidebar's isBlocking).
  const blockedIds = useMemo(() => blockedScenarioIds(comments, pages), [comments, pages]);
  const pageComments = useMemo(
    () => comments.filter((c) => c.pageId === selectedPageId),
    [comments, selectedPageId],
  );

  // Only trust the rendered text when it belongs to the page now selected; otherwise ""
  // (the sidebar then treats every comment as unanchored for the one frame until text lands).
  const pageText = rendered.pageId === selectedPageId ? rendered.text : "";

  // Stable callback — WikiPage uses it as an effect dep, so an inline closure would re-fire the effect.
  const handlePageText = useCallback((text: string) => setRendered({ pageId: selectedPageId, text }), [selectedPageId]);

  const onComment = useCallback(
    async (c: NewComment) => {
      if (!selectedPage) return;
      await postComment(teamId, slug, { pageId: selectedPage.id, ...c });
    },
    [teamId, slug, selectedPage],
  );

  return (
    <div className="wiki-layout">
      <WikiNav
        pages={pages} scenarios={scenarios} scores={scores} testRuns={testRuns} verifications={verifications}
        blockedIds={blockedIds} comments={comments} selectedPageId={selectedPageId} onSelect={setPicked}
      />
      <div className="wiki-layout-main">
        {selectedPage ? (
          <WikiPage
            page={selectedPage} scenarios={scenarios} scores={scores} testRuns={testRuns} verifications={verifications}
            blockedIds={blockedIds} comments={pageComments} onComment={onComment} onPageTextChange={handlePageText}
          />
        ) : (
          <p className="dim">No pages.</p>
        )}
      </div>
      {selectedPage && (
        <CommentSidebar
          comments={pageComments} pageText={pageText} currentUid={currentUid} isAdmin={isAdmin}
          onAccept={(id) => acceptComment(teamId, slug, id)}
        />
      )}
    </div>
  );
}
