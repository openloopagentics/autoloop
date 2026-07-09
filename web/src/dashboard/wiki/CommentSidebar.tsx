import { locateAnchor } from "./anchor";
import type { PageComment } from "../types";

/** True when a blocking comment is currently gating the loop (open & not accepted). */
export function isBlocking(c: PageComment): boolean {
  return c.severity === "blocking" && !(c.status !== "open" && c.accepted === true);
}

/**
 * Accept is allowed for the comment's author or a team owner/admin (the backend
 * enforces this; the UI mirrors it). When `isAdmin` isn't wired through, the button
 * gates to author-only — the backend still lets an admin accept.
 */
function canAccept(c: PageComment, currentUid?: string, isAdmin?: boolean): boolean {
  return Boolean(isAdmin) || (currentUid !== undefined && c.author === currentUid);
}

/** Open comments sort before resolved/declined; otherwise document order is kept. */
function byOpenFirst(a: PageComment, b: PageComment): number {
  const rank = (c: PageComment) => (c.status === "open" || c.status === undefined ? 0 : 1);
  return rank(a) - rank(b);
}

function SeverityBadge({ c }: { c: PageComment }) {
  if (c.severity !== "blocking") return <span className="cmt-badge cmt-badge--advisory">advisory</span>;
  return <span className={`cmt-badge cmt-badge--blocking${isBlocking(c) ? " is-active" : ""}`}>blocking</span>;
}

function StatusChip({ status }: { status?: PageComment["status"] }) {
  const s = status ?? "open";
  return <span className={`cmt-status cmt-status--${s}`}>{s}</span>;
}

function Thread({ c, currentUid, isAdmin, onAccept }: {
  c: PageComment;
  currentUid?: string;
  isAdmin?: boolean;
  onAccept: (id: string) => void;
}) {
  const showAccept = isBlocking(c) && canAccept(c, currentUid, isAdmin);
  return (
    <li className="cmt-thread" data-comment-id={c.id}>
      <div className="cmt-thread-head">
        <SeverityBadge c={c} />
        <StatusChip status={c.status} />
      </div>
      {c.anchor?.exact && <blockquote className="cmt-thread-quote">{c.anchor.exact}</blockquote>}
      {c.body && <p className="cmt-thread-body">{c.body}</p>}
      {c.thread && c.thread.length > 0 && (
        <ul className="cmt-replies">
          {c.thread.map((r, i) => (
            <li key={i} className={`cmt-reply cmt-reply--${r.by}`}>
              <span className="cmt-reply-by">{r.by}</span>
              <span className="cmt-reply-text">{r.text}</span>
            </li>
          ))}
        </ul>
      )}
      {c.accepted && <p className="cmt-accepted">Accepted{c.acceptedBy ? ` by ${c.acceptedBy}` : ""}</p>}
      {showAccept && (
        <button type="button" className="btn btn--primary cmt-accept" onClick={() => onAccept(c.id)}>
          Accept &amp; unblock
        </button>
      )}
    </li>
  );
}

/**
 * Right-rail threads for the page the reader is on. Comments split into an
 * "anchored" section (those whose anchor still locates in the page, open ones
 * first) and an "unanchored" section (anchor orphaned — the passage was edited or
 * removed). A red badge counts open blocking comments. Props-in only; accept is a
 * callback (Task 10 wires it to acceptComment).
 *
 * `pageText` MUST be the RENDERED page's flat text (WikiPage's container.textContent
 * via its `onPageTextChange` callback), NOT the raw `page.markdown`. Anchors are built
 * from rendered text (that's what the reader selects and what the server stores), so
 * markdown syntax like "**bold**" would never round-trip and would wrongly orphan
 * every comment on formatted prose.
 */
export function CommentSidebar({ comments, pageText, currentUid, isAdmin, onAccept }: {
  comments: PageComment[];
  pageText: string;
  currentUid?: string;
  isAdmin?: boolean;
  onAccept: (id: string) => void;
}) {
  const anchored: PageComment[] = [];
  const unanchored: PageComment[] = [];
  for (const c of comments) {
    const located = c.anchor ? locateAnchor(pageText, { exact: c.anchor.exact, prefix: c.anchor.prefix ?? "", suffix: c.anchor.suffix ?? "" }) : null;
    (located ? anchored : unanchored).push(c);
  }
  anchored.sort(byOpenFirst);

  const blockingCount = comments.filter(isBlocking).length;

  if (comments.length === 0) {
    return (
      <aside className="cmt-sidebar" aria-label="Comments">
        <p className="cmt-sidebar-empty">No comments on this page.</p>
      </aside>
    );
  }

  return (
    <aside className="cmt-sidebar" aria-label="Comments">
      <div className="cmt-sidebar-head">
        <h4 className="cmt-sidebar-title">Comments</h4>
        {blockingCount > 0 && (
          <span className="cmt-blocking-count" aria-label={`${blockingCount} open blocking comments`}>{blockingCount}</span>
        )}
      </div>
      {anchored.length > 0 && (
        <ul className="cmt-list cmt-list--anchored">
          {anchored.map((c) => (
            <Thread key={c.id} c={c} currentUid={currentUid} isAdmin={isAdmin} onAccept={onAccept} />
          ))}
        </ul>
      )}
      {unanchored.length > 0 && (
        <section className="cmt-unanchored" aria-label="Unanchored comments">
          <h5 className="cmt-unanchored-head">Unanchored</h5>
          <ul className="cmt-list">
            {unanchored.map((c) => (
              <Thread key={c.id} c={c} currentUid={currentUid} isAdmin={isAdmin} onAccept={onAccept} />
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
