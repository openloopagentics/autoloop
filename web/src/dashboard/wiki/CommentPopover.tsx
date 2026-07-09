import { useState } from "react";
import { ErrorNote } from "../components/ErrorNote";

/**
 * The compose box that appears next to a text selection. Body + advisory/blocking
 * toggle (advisory is the safe default) + Submit; busy/error states follow the
 * MessagesTab guard idiom. Positioning is the caller's job — this renders inline
 * and the caller wraps it in an absolutely-positioned host.
 */
export function CommentPopover({
  quote,
  onSubmit,
  onCancel,
}: {
  quote: string;
  onSubmit: (input: { body: string; severity: "advisory" | "blocking" }) => Promise<void>;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<"advisory" | "blocking">("advisory");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ body: body.trim(), severity });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cmt-popover" role="dialog" aria-label="Add a comment">
      <blockquote className="cmt-popover-quote">{quote}</blockquote>
      <textarea
        className="cmt-popover-input"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Steer the agent on this passage…"
        rows={3}
        autoFocus
        disabled={busy}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void handleSubmit(); }
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
      />
      <div className="cmt-popover-sev" role="radiogroup" aria-label="Severity">
        <button
          type="button"
          role="radio"
          aria-checked={severity === "advisory"}
          className={`cmt-sev${severity === "advisory" ? " is-active" : ""}`}
          onClick={() => setSeverity("advisory")}
        >
          Advisory
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={severity === "blocking"}
          className={`cmt-sev cmt-sev--blocking${severity === "blocking" ? " is-active" : ""}`}
          onClick={() => setSeverity("blocking")}
        >
          Blocking
        </button>
      </div>
      {error && <ErrorNote message={error} />}
      <div className="cmt-popover-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn--primary" onClick={() => void handleSubmit()} disabled={busy || !body.trim()}>
          {busy ? "Posting…" : "Comment"}
        </button>
      </div>
    </div>
  );
}
