import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

/** Renders markdown text into styled HTML. Safe by default — react-markdown does not
 *  render raw HTML unless explicitly enabled, so untrusted content can't inject markup.
 *  - remark-gfm: tables, strikethrough, task lists, autolinks
 *  - remark-breaks: a single newline becomes a line break (GitHub-comment style), so
 *    line-separated content (e.g. run logs) keeps its lines instead of collapsing into a
 *    wall of text.
 *  `components` (optional) merges over the defaults — callers can override element
 *  renderers (e.g. the wiki reader overrides `code` to render live scenario cards). */
export function Markdown({ children, className, components }: { children: string; className?: string; components?: Components }) {
  return (
    <div className={`md${className ? " " + className : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          // open links in a new tab, safely
          a: ({ href, children: c }) => <a href={href} target="_blank" rel="noopener noreferrer">{c}</a>,
          ...components,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
