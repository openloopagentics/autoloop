import { Markdown } from "./Markdown";
import type { DocumentRec } from "../types";

/** True when the text has markdown structure (heading, list, fence, quote, link, table).
 *  Documents are sometimes stored as format:"markdown" but actually contain raw code —
 *  those should render as a code block, not be parsed as markdown prose. */
function looksLikeMarkdown(s: string): boolean {
  return /(^|\n) {0,3}#{1,6}\s|(^|\n) {0,3}[-*+]\s|(^|\n) {0,3}\d+\.\s|```|(^|\n) {0,3}>\s|\[[^\]]+\]\([^)]+\)|(^|\n)\s*\|.+\|/.test(s);
}

export function DocumentsSection({ documents }: { documents: DocumentRec[] }) {
  if (documents.length === 0) return null;
  return (
    <section>
      <div className="proj-section-head"><h2 className="proj-section-title">Documents</h2></div>
      <div className="doclist">
        {documents.map((d) => (
          <div key={d.id} className="docrow card">
            <div className="docrow-head">
              {/* url docs: the TITLE is the link (accessible name = title); markdown: plain title + <pre> body */}
              {d.format === "url"
                ? <a className="docrow-title" href={d.content} target="_blank" rel="noopener noreferrer">{d.title ?? d.id}</a>
                : <span className="docrow-title">{d.title ?? d.id}</span>}
              <code className="chip">{d.kind}</code>
            </div>
            {d.format === "url"
              ? <span className="docrow-url dim mono">{d.content}</span>
              : looksLikeMarkdown(d.content ?? "")
                ? <Markdown>{d.content ?? ""}</Markdown>
                : <pre className="doc-pre mono">{d.content}</pre>}
          </div>
        ))}
      </div>
    </section>
  );
}
