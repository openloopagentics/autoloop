import type { KeyMeta } from "../types";
export function KeyRow({ keyMeta, onRevoke }: { keyMeta: KeyMeta; onRevoke: (id: string) => void }) {
  return (
    <li className="key-row">
      <code>{keyMeta.prefix}…</code> <span>{keyMeta.label}</span>
      <button onClick={() => onRevoke(keyMeta.id)}>Revoke</button>
    </li>
  );
}
