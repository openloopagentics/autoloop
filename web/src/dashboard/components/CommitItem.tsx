import type { Commit } from "../types";

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function CommitItem({ commit }: { commit: Commit }) {
  const t = commit.tokens;
  return (
    <li className="commit">
      <code className="commit-sha mono">{commit.sha.slice(0, 7)}</code>
      <span className="commit-msg mono">{commit.message}</span>
      <span className="commit-author">{commit.author}</span>
      {t && (
        <span
          className="commit-tokens tnum"
          title={`input ${t.input.toLocaleString()} · output ${t.output.toLocaleString()} · cache read ${t.cacheRead.toLocaleString()} · cache write ${t.cacheWrite.toLocaleString()}`}
        >
          {fmt(t.total)} tok
        </span>
      )}
    </li>
  );
}
