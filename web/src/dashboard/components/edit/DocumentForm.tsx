import { useState } from "react";

export interface DocumentBody { kind: string; title: string; format: "markdown" | "url"; content: string; }

const MAX_CONTENT = 100 * 1024;

export function DocumentForm({ initial, onSave }: {
  initial?: { kind?: string; title?: string; format?: "markdown" | "url"; content?: string };
  onSave: (body: DocumentBody) => Promise<void>;
}) {
  const editing = initial != null;
  const [kind, setKind] = useState(initial?.kind ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [format, setFormat] = useState<"markdown" | "url">(initial?.format ?? "markdown");
  const [content, setContent] = useState(initial?.content ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooBig = new Blob([content]).size > MAX_CONTENT;
  const canSubmit = kind.trim().length > 0 && title.trim().length > 0 && content.trim().length > 0 && !tooBig && !pending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      await onSave({ kind: kind.trim(), title: title.trim(), format, content });
      if (!editing) { setKind(""); setTitle(""); setFormat("markdown"); setContent(""); }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="edit-form edit-form--col" onSubmit={submit}>
      <div className="edit-row">
        <input className="input" aria-label="Document kind" placeholder="Kind — e.g. spec"
          value={kind} onChange={(e) => setKind(e.target.value)} />
        <input className="input" aria-label="Document title" placeholder="Document title"
          value={title} onChange={(e) => setTitle(e.target.value)} />
        <select className="select" aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value as "markdown" | "url")}>
          <option value="markdown">markdown</option>
          <option value="url">url</option>
        </select>
      </div>
      <textarea className="input edit-textarea" aria-label="Document content" placeholder="Content"
        value={content} onChange={(e) => setContent(e.target.value)} rows={4} />
      <div className="edit-row">
        <button className="btn btn-sm" type="submit" disabled={!canSubmit}>{editing ? "Save document" : "Add document"}</button>
      </div>
      {tooBig && <p role="alert" className="err edit-err">Content exceeds 100KB.</p>}
      {error && <p role="alert" className="err edit-err">{error}</p>}
    </form>
  );
}
