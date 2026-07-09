import { isValidElement } from "react";
import { Markdown } from "../components/Markdown";
import { ScenarioCard } from "../components/ScenarioCard";
import { Mermaid } from "./Mermaid";
import { parseBlockBody } from "./blockBody";
import type { Components } from "react-markdown";
import type { Page, Scenario, Score, TestRun, Verification } from "../types";

// Fence languages the code override turns into block-level renderers (not <code>).
// A <pre> wrapping one of these must be unwrapped, or the card/diagram inherits
// the pre chrome (monospace, white-space:pre, .md pre inset/border) from index.css.
const BLOCK_LANGS = /language-(scenario|goal|mermaid)\b/;

/** A record parsed from a goal/scenario fence body: has an optional id/title/description. */
type ParsedBody = { id?: unknown; title?: unknown; description?: unknown } | null;

function tryParse(body: string): ParsedBody {
  try {
    const v = parseBlockBody(body);
    return v && typeof v === "object" ? (v as ParsedBody) : null;
  } catch {
    return null;
  }
}

function InvalidBlock({ code }: { code: string }) {
  return (
    <div className="wiki-block-invalid">
      <pre>{code}</pre>
      <span className="wiki-block-note">invalid block</span>
    </div>
  );
}

/**
 * Renders a loop-authored wiki page: markdown with fenced goal/scenario/mermaid
 * blocks. Scenario fences resolve to a live ScenarioCard (status computed from the
 * props, blocked badge when in `blockedIds`); goal fences to a compact header;
 * mermaid to a rendered diagram. Every fence path is crash-safe: an unparseable
 * body or an unknown scenario id degrades to a plain code block + "invalid block".
 * Props-in/render-out — no data fetching here (composed by ProjectDetail).
 */
export function WikiPage({ page, scenarios, scores, testRuns, verifications, blockedIds }: {
  page: Page;
  scenarios: Scenario[];
  scores: Score[];
  testRuns: TestRun[];
  verifications: Verification[];
  blockedIds?: Set<string>;
}) {
  const byId = new Map(scenarios.map((s) => [s.id, s]));

  const components: Components = {
    pre({ children, ...rest }) {
      // When the fenced block is one of our block renderers, drop the <pre> wrapper
      // so the card/goal/diagram isn't nested inside pre chrome; the code override
      // below produces the real element. Ordinary fences keep the default <pre>.
      const child = Array.isArray(children) ? children[0] : children;
      if (isValidElement<{ className?: string }>(child) && BLOCK_LANGS.test(child.props.className ?? "")) {
        return <>{children}</>;
      }
      return <pre {...rest}>{children}</pre>;
    },
    code({ className, children, ...rest }) {
      const lang = /language-(\w+)/.exec(className ?? "")?.[1];
      // Inline code (no fence language) passes straight through to the default renderer.
      if (!lang) return <code className={className} {...rest}>{children}</code>;
      const body = String(children ?? "").replace(/\n$/, "");

      if (lang === "mermaid") return <Mermaid code={body} />;

      if (lang === "scenario") {
        const parsed = tryParse(body);
        const id = typeof parsed?.id === "string" ? parsed.id : null;
        const scenario = id ? byId.get(id) : undefined;
        if (!scenario) return <InvalidBlock code={body} />;
        const blocked = blockedIds?.has(scenario.id) ?? false;
        return (
          <div data-scenario-id={scenario.id} className="wiki-scenario">
            {blocked && <span className="wiki-blocked-badge">blocked</span>}
            <ScenarioCard scenario={scenario} scores={scores} testRuns={testRuns} verifications={verifications} blockedIds={blockedIds} />
          </div>
        );
      }

      if (lang === "goal") {
        const parsed = tryParse(body);
        if (!parsed) return <InvalidBlock code={body} />;
        const title = typeof parsed.title === "string" ? parsed.title : (typeof parsed.id === "string" ? parsed.id : "Goal");
        const description = typeof parsed.description === "string" ? parsed.description : null;
        return (
          <div className="wiki-goal">
            <span className="wiki-goal-title">{title}</span>
            {description && <p className="wiki-goal-desc">{description}</p>}
          </div>
        );
      }

      // Any other fenced language → default code-block rendering.
      return <code className={className} {...rest}>{children}</code>;
    },
  };

  return <Markdown className="wiki-page" components={components}>{page.markdown ?? ""}</Markdown>;
}
