import ReactMarkdown from "react-markdown";

/** Renders markdown text into styled HTML. Safe by default — react-markdown does not
 *  render raw HTML unless explicitly enabled, so untrusted content can't inject markup. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`md${className ? " " + className : ""}`}>
      <ReactMarkdown
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
