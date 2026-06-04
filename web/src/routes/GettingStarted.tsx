import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/context";

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="gs-step">
      <span className="gs-num">{n}</span>
      <div className="gs-step-body">
        <h2 className="gs-step-title">{title}</h2>
        {children}
      </div>
    </section>
  );
}

export function GettingStarted() {
  const { user } = useAuth();
  return (
    <div className="main main--narrow">
      <div className="page-head">
        <span className="eyebrow">Getting started</span>
        <h1 className="page-title">Welcome to Autoloop</h1>
        <p className="page-sub">
          Autoloop is a live status board for software built in a loop by AI coding agents.
          Agents report progress through a write-only API; this site shows it updating in real time.
        </p>
      </div>

      <p className="gs-intro">
        The data model is simple: a <strong>team</strong> owns <strong>projects</strong>, each project
        moves through ordered <strong>phases</strong>, and each phase collects the <strong>commits</strong>
        your agents make. Here's how to go from zero to a live dashboard.
      </p>

      <div className="gs-steps">
        <Step n={1} title="Join or create a team">
          <p>
            Projects live under a team. Create one (you become its owner) or accept an invite on the{" "}
            <Link className="gs-link" to="/teams">Teams</Link> page. Owners and admins can invite teammates by email.
          </p>
        </Step>

        <Step n={2} title="Mint an API key">
          <p>
            Your agents authenticate with a personal API key. Create one on the{" "}
            <Link className="gs-link" to="/keys">API keys</Link> page — copy it once (it's shown only then),
            and expose it to your loop:
          </p>
          <pre className="gs-pre"><code>export AUTOLOOP_API_KEY=…</code></pre>
        </Step>

        <Step n={3} title="Install the reporting skill">
          <p>The skill teaches Claude Code (or Codex) to report status as the loop runs. Two ways:</p>
          <p><strong>Plugin (auto-updates):</strong></p>
          <pre className="gs-pre"><code>/plugin marketplace add openloopagentics/autoloop
/plugin install autoloop-reporting@autoloop</code></pre>
          <p><strong>Or one-shot install</strong> — paste to Claude Code, or run it yourself:</p>
          <pre className="gs-pre"><code>curl -fsSL https://daloop-42b47.web.app/skill/install.sh | bash</code></pre>
          <p className="gs-muted">
            Full instructions: <a className="gs-link" href="/skill/" target="_blank" rel="noopener">daloop-42b47.web.app/skill</a>
          </p>
        </Step>

        <Step n={4} title="Point a loop at your project">
          <p>In the loop's working directory, initialize once — then the skill reports automatically:</p>
          <pre className="gs-pre"><code>autoloop init --team &lt;teamId&gt; --project &lt;slug&gt;</code></pre>
          <p>
            As the loop runs, the project, its phases, and each commit appear live on your{" "}
            <Link className="gs-link" to="/dashboard">Dashboard</Link>.
          </p>
        </Step>
      </div>

      <div className="gs-cta">
        <Link className="btn" to="/dashboard">Go to your dashboard →</Link>
        {!user?.email && <span className="gs-muted">Sign in to begin.</span>}
      </div>
    </div>
  );
}
