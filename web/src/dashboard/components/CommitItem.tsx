import type { Commit } from "../types";
export function CommitItem({ commit }: { commit: Commit }) {
  return (
    <li className="commit">
      <code className="commit-sha mono">{commit.sha.slice(0, 7)}</code>
      <span className="commit-msg mono">{commit.message}</span>
      <span className="commit-author">{commit.author}</span>
    </li>
  );
}
