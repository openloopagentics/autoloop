import type { DocumentRec } from "../types";

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
              : <pre className="doc-pre mono">{d.content}</pre>}
          </div>
        ))}
      </div>
    </section>
  );
}
