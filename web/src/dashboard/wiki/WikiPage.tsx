import { isValidElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "../components/Markdown";
import { ScenarioCard } from "../components/ScenarioCard";
import { Mermaid } from "./Mermaid";
import { parseBlockBody } from "./blockBody";
import { makeAnchor, locateAnchor, type Anchor } from "./anchor";
import { offsetInContainer } from "./domOffsets";
import { CommentPopover } from "./CommentPopover";
import type { Components } from "react-markdown";
import type { Page, PageComment, Scenario, Score, TestRun, Verification } from "../types";

/** Everything WikiPage hands up when the reader submits a steering comment. */
export interface NewComment {
  anchor: Anchor;
  body: string;
  severity: "advisory" | "blocking";
  targetScenarioId?: string;
}

// Fence languages the code override turns into block-level renderers (not <code>).
// A <pre> wrapping one of these must be unwrapped, or the card/diagram inherits
// the pre chrome (monospace, white-space:pre, .md pre inset/border) from index.css.
const BLOCK_LANGS = /language-(scenario|goal|mermaid)\b/;

/** A record parsed from a goal/scenario fence body: has an optional id/title/description. */
type ParsedBody = { id?: unknown; title?: unknown; description?: unknown } | null;

function tryParse(body: string): ParsedBody {
  try {
    const v = parseBlockBody(body);
    return v && typeof v === "object" ? (v as ParsedBody) : null;
  } catch {
    return null;
  }
}

function InvalidBlock({ code }: { code: string }) {
  return (
    <div className="wiki-block-invalid">
      <pre>{code}</pre>
      <span className="wiki-block-note">invalid block</span>
    </div>
  );
}

/**
 * The markdown body, isolated in its own memoized component so selection/popover
 * state on the outer WikiPage never re-parses the (potentially large) page. It
 * re-renders only when a value that actually changes the rendered output changes.
 */
const PageBody = ({ page, scenarios, scores, testRuns, verifications, blockedIds }: {
  page: Page;
  scenarios: Scenario[];
  scores: Score[];
  testRuns: TestRun[];
  verifications: Verification[];
  blockedIds?: Set<string>;
}) => {
  const byId = new Map(scenarios.map((s) => [s.id, s]));

  const components: Components = {
    pre({ children, ...rest }) {
      // When the fenced block is one of our block renderers, drop the <pre> wrapper
      // so the card/goal/diagram isn't nested inside pre chrome; the code override
      // below produces the real element. Ordinary fences keep the default <pre>.
      const child = Array.isArray(children) ? children[0] : children;
      if (isValidElement<{ className?: string }>(child) && BLOCK_LANGS.test(child.props.className ?? "")) {
        return <>{children}</>;
      }
      return <pre {...rest}>{children}</pre>;
    },
    code({ className, children, ...rest }) {
      const lang = /language-(\w+)/.exec(className ?? "")?.[1];
      // Inline code (no fence language) passes straight through to the default renderer.
      if (!lang) return <code className={className} {...rest}>{children}</code>;
      const body = String(children ?? "").replace(/\n$/, "");

      if (lang === "mermaid") return <Mermaid code={body} />;

      if (lang === "scenario") {
        const parsed = tryParse(body);
        const id = typeof parsed?.id === "string" ? parsed.id : null;
        const scenario = id ? byId.get(id) : undefined;
        if (!scenario) return <InvalidBlock code={body} />;
        const blocked = blockedIds?.has(scenario.id) ?? false;
        return (
          <div data-scenario-id={scenario.id} className="wiki-scenario">
            {blocked && <span className="wiki-blocked-badge">blocked</span>}
            <ScenarioCard scenario={scenario} scores={scores} testRuns={testRuns} verifications={verifications} blockedIds={blockedIds} />
          </div>
        );
      }

      if (lang === "goal") {
        const parsed = tryParse(body);
        if (!parsed) return <InvalidBlock code={body} />;
        const title = typeof parsed.title === "string" ? parsed.title : (typeof parsed.id === "string" ? parsed.id : "Goal");
        const description = typeof parsed.description === "string" ? parsed.description : null;
        return (
          <div className="wiki-goal">
            <span className="wiki-goal-title">{title}</span>
            {description && <p className="wiki-goal-desc">{description}</p>}
          </div>
        );
      }

      // Any other fenced language → default code-block rendering.
      return <code className={className} {...rest}>{children}</code>;
    },
  };

  return <Markdown className="wiki-page" components={components}>{page.markdown ?? ""}</Markdown>;
};

/** Re-render the body only when a load-bearing input changes — NOT on popover state. */
const MemoPageBody = ({ page, scenarios, scores, testRuns, verifications, blockedIds }: Parameters<typeof PageBody>[0]) => {
  return useMemo(
    () => <PageBody page={page} scenarios={scenarios} scores={scores} testRuns={testRuns} verifications={verifications} blockedIds={blockedIds} />,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page.markdown, scenarios, scores, testRuns, verifications, blockedIds],
  );
};

interface PendingSelection {
  anchor: Anchor;
  quote: string;
  targetScenarioId?: string;
  top: number;
  left: number;
}

/**
 * Renders a loop-authored wiki page and layers steering-comment interaction on top:
 * selecting text pops a compose box (CommentPopover) whose submission is reported via
 * `onComment(newComment)` (anchor + body + severity + optional targetScenarioId). The
 * anchor is built here; targetScenarioId is stamped when the selection starts inside a
 * scenario card. Existing located comments are highlighted with
 * the CSS Custom Highlight API (degrades silently where unsupported). The markdown body
 * is memoized so selection/popover state never re-parses the page.
 *
 * `onPageTextChange` reports the rendered body's flat text after each content change —
 * this is what CommentSidebar's `pageText` must be fed (anchors are built from rendered
 * text, so re-locating against raw markdown would orphan every formatted-prose comment).
 * Props-in/render-out — no data fetching here.
 */
export function WikiPage({ page, scenarios, scores, testRuns, verifications, blockedIds, comments, onComment, onPageTextChange }: {
  page: Page;
  scenarios: Scenario[];
  scores: Score[];
  testRuns: TestRun[];
  verifications: Verification[];
  blockedIds?: Set<string>;
  comments?: PageComment[];
  onComment?: (comment: NewComment) => Promise<void>;
  onPageTextChange?: (text: string) => void;
}) {
  // bodyRef wraps ONLY the memoized markdown, never the popover — so its textContent is
  // the clean page text (offset walks, highlight ranges, and onPageTextChange all use it).
  // hostRef is the positioned outer box the popover is placed relative to.
  const hostRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const pageText = page.markdown ?? "";

  const handleMouseUp = useCallback(() => {
    if (!onComment) return;
    const container = bodyRef.current;
    if (!container) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setPending(null); return; }
    const range = sel.getRangeAt(0);
    // Only anchor selections inside the page body — never the popover UI.
    if (!container.contains(range.commonAncestorContainer)) { setPending(null); return; }

    const start = offsetInContainer(container, range.startContainer, range.startOffset);
    const end = offsetInContainer(container, range.endContainer, range.endOffset);
    if (start === null || end === null || start === end) { setPending(null); return; }
    const [lo, hi] = start <= end ? [start, end] : [end, start];

    // Offsets are into the container's textContent; the anchor is built against the
    // same flattened text so locateAnchor(container.textContent, …) round-trips.
    const flat = container.textContent ?? "";
    let anchor: Anchor;
    try { anchor = makeAnchor(flat, lo, hi); } catch { setPending(null); return; }

    // Stamp the scenario id iff the selection begins inside a scenario card.
    const anchorEl = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as Element)
      : range.startContainer.parentElement;
    const scoped = anchorEl?.closest("[data-scenario-id]");
    const targetScenarioId = scoped?.getAttribute("data-scenario-id") ?? undefined;

    // Position the popover just under the selection, relative to the page host.
    // getBoundingClientRect is absent on Ranges in some test/older environments —
    // fall back to the container origin so the popover still shows.
    const rect = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
    const box = (hostRef.current ?? container).getBoundingClientRect();
    setPending({
      anchor,
      quote: anchor.exact,
      targetScenarioId,
      top: rect ? rect.bottom - box.top : 0,
      left: rect ? rect.left - box.left : 0,
    });
  }, [onComment]);

  // Report the rendered body's flat text whenever the rendered content changes (NOT on
  // popover open — deps mirror the memoized body's inputs). This is what CommentSidebar
  // re-locates comments against; feeding it raw markdown would orphan formatted-prose
  // comments, since anchors are built from rendered text.
  useEffect(() => {
    if (!onPageTextChange) return;
    onPageTextChange(bodyRef.current?.textContent ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageText, scenarios, scores, testRuns, verifications, blockedIds, onPageTextChange]);

  // Highlight located comment anchors via the CSS Custom Highlight API. Guarded so
  // environments without it (jsdom, older browsers) degrade silently — no highlights,
  // no crash. Re-runs when the page body or the comment set changes.
  useEffect(() => {
    if (typeof Highlight === "undefined" || !CSS?.highlights) return;
    const body = bodyRef.current;
    if (!body) return;
    const flat = body.textContent ?? "";
    const ranges: Range[] = [];
    for (const c of comments ?? []) {
      if (!c.anchor?.exact) continue;
      const loc = locateAnchor(flat, { exact: c.anchor.exact, prefix: c.anchor.prefix ?? "", suffix: c.anchor.suffix ?? "" });
      if (!loc) continue;
      const range = rangeForOffsets(body, loc.start, loc.end);
      if (range) ranges.push(range);
    }
    const key = "wiki-comment";
    if (ranges.length === 0) { CSS.highlights.delete(key); return; }
    CSS.highlights.set(key, new Highlight(...ranges));
    return () => { CSS.highlights?.delete(key); };
  }, [comments, pageText, scenarios, scores, testRuns, verifications, blockedIds]);

  async function submit(input: { body: string; severity: "advisory" | "blocking" }) {
    if (!pending || !onComment) return;
    await onComment({ anchor: pending.anchor, body: input.body, severity: input.severity, targetScenarioId: pending.targetScenarioId });
    setPending(null);
  }

  return (
    <div className="wiki-page-host" ref={hostRef}>
      <div className="wiki-page-body" ref={bodyRef} onMouseUp={onComment ? handleMouseUp : undefined}>
        <MemoPageBody page={page} scenarios={scenarios} scores={scores} testRuns={testRuns} verifications={verifications} blockedIds={blockedIds} />
      </div>
      {pending && onComment && (
        <div className="cmt-popover-host" style={{ top: pending.top, left: pending.left }}>
          <CommentPopover quote={pending.quote} onSubmit={submit} onCancel={() => setPending(null)} />
        </div>
      )}
    </div>
  );
}

/** Build a DOM Range spanning [start, end) of the container's flattened text. */
function rangeForOffsets(container: Node, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let startNode: Node | null = null;
  let startOff = 0;
  let endNode: Node | null = null;
  let endOff = 0;
  for (let tn = walker.nextNode(); tn; tn = walker.nextNode()) {
    const len = (tn.textContent ?? "").length;
    if (startNode === null && acc + len >= start) { startNode = tn; startOff = start - acc; }
    if (endNode === null && acc + len >= end) { endNode = tn; endOff = end - acc; break; }
    acc += len;
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startOff);
  range.setEnd(endNode, endOff);
  return range;
}
