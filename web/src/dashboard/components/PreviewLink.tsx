/** "Open preview ↗" anchor for a loop's reported preview deploy.
 *  Hidden when the URL is absent OR null (the contract stores null to clear).
 *  Plain link — no iframe embedding (preview hosts set their own frame policies). */
export function PreviewLink({ url }: { url?: string | null }) {
  if (!url) return null;
  return (
    <a className="preview-link" href={url} target="_blank" rel="noopener noreferrer">
      Open preview ↗
    </a>
  );
}
