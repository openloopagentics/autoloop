import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

/** Renders markdown text into styled HTML. Safe by default — react-markdown does not
 *  render raw HTML unless explicitly enabled, so untrusted content can't inject markup.
 *  - remark-gfm: tables, strikethrough, task lists, autolinks
 *  - remark-breaks: a single newline becomes a line break (GitHub-comment style), so
 *    line-separated content (e.g. run logs) keeps its lines instead of collapsing into a
 *    wall of text. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`md${className ? " " + className : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          // open links in a new tab, safely
          a: ({ href, children: c }) => <a href={href} target="_blank" rel="noopener noreferrer">{c}</a>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
