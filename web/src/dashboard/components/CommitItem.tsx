import type { Commit } from "../types";
export function CommitItem({ commit }: { commit: Commit }) {
  return (
    <li className="commit">
      <code>{commit.sha.slice(0, 7)}</code> <span>{commit.message}</span> <em>{commit.author}</em>
    </li>
  );
}
