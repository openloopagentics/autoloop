import { useEffect, useId, useState } from "react";

let mermaidReady: Promise<typeof import("mermaid").default> | null = null;
// Lazy-load + init mermaid once, shared across every diagram on the page.
function loadMermaid() {
  if (!mermaidReady) {
    mermaidReady = import("mermaid").then((m) => {
      const mermaid = m.default;
      mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
      return mermaid;
    });
  }
  return mermaidReady;
}

/** Renders a mermaid diagram to inline SVG. A parse/render failure falls back to
 *  a <pre> showing the source — a bad diagram must never crash the surrounding page. */
export function Mermaid({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // mermaid.render needs a DOM-id-valid, unique id; useId gives a stable one per
  // instance but may contain ":" which is invalid in an id, so strip non-word chars.
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);
    loadMermaid()
      .then((mermaid) => mermaid.render(id, code))
      .then(({ svg }) => { if (!cancelled) setSvg(svg); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [code, id]);

  if (failed) return <pre className="wiki-mermaid-err">{code}</pre>;
  if (svg === null) return <pre className="wiki-mermaid-loading">{code}</pre>;
  return <div className="wiki-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}
