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
          Autoloop drives a vision-driven, self-scoring build loop with an AI coding agent and shows it
          on a live dashboard. You define what "done" means as a set of scenarios; the loop implements
          features, writes and runs tests, scores each scenario, tracks bugs, and keeps iterating —
          reporting every step in real time.
        </p>
      </div>

      <p className="gs-intro">
        The model: a <strong>team</strong> owns <strong>projects</strong>. A project's{" "}
        <strong>vision</strong> is a set of <strong>goals</strong> and <strong>scenarios</strong> (with
        scoring rubrics). The loop runs in <strong>iterations</strong>, each made of{" "}
        <strong>tasks</strong> that produce <strong>commits</strong>, <strong>test runs</strong>,{" "}
        <strong>scores</strong>, and <strong>bugs</strong>. A scenario is <strong>met</strong> when it
        has a passing test and a score above its threshold. Here's how to go from zero to a live loop.
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
            Your agent authenticates with a personal API key. Create one on the{" "}
            <Link className="gs-link" to="/keys">API keys</Link> page — copy it once (it's shown only then),
            and export it in the shell you launch Claude Code from:
          </p>
          <pre className="gs-pre"><code>export AUTOLOOP_API_KEY=…</code></pre>
        </Step>

        <Step n={3} title="Install the Autoloop plugin">
          <p>
            The plugin gives Claude Code the loop-driver skills (<code>/autoloop</code>,{" "}
            <code>/autoloop-vision</code>) and the bundled <code>autoloop</code> CLI. Two ways:
          </p>
          <p><strong>Plugin (auto-updates):</strong></p>
          <pre className="gs-pre"><code>{`/plugin marketplace add openloopagentics/autoloop
/plugin install autoloop@autoloop`}</code></pre>
          <p><strong>Or one-shot install</strong> — paste to Claude Code, or run it yourself:</p>
          <pre className="gs-pre"><code>curl -fsSL https://daloop-42b47.web.app/skill/install.sh | bash</code></pre>
          <p className="gs-muted">
            Full instructions: <a className="gs-link" href="/skill/" target="_blank" rel="noopener">daloop-42b47.web.app/skill</a>
          </p>
        </Step>

        <Step n={4} title="Author your vision">
          <p>
            In your project directory, run <code>/autoloop-vision</code> in Claude Code. It interviews you
            and writes a <code>vision/</code> wiki — pages describing the product with goals and scenarios
            (and scoring rubrics) embedded, defining what "done" means. This is what the loop builds toward
            and scores against.
          </p>
        </Step>

        <Step n={5} title="Run the loop">
          <p>Initialize once, then start the loop:</p>
          <pre className="gs-pre"><code>{`autoloop init --team <teamId> --project <slug> --session-log
# then, in Claude Code:
/autoloop`}</code></pre>
          <p>
            <code>--session-log</code> streams the live session transcript to the dashboard. As the loop
            runs, your{" "}
            <Link className="gs-link" to="/dashboard">Dashboard</Link> updates in real time — scenarios
            turning met/unmet, the <strong>Tests</strong> and <strong>Bugs</strong> tabs, per-commit token
            counts, and the <strong>Session Log</strong>. Send the loop a message any time to steer or pause
            it, or comment on any <strong>Vision</strong> page to steer it in place — a blocking comment
            holds a scenario back until the loop resolves it.
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
