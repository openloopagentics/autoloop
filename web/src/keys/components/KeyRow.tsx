import type { KeyMeta } from "../types";
export function KeyRow({ keyMeta, onRevoke }: { keyMeta: KeyMeta; onRevoke: (id: string) => void }) {
  return (
    <li className="keyrow">
      <div className="keyrow-main">
        <span className="keyrow-label">{keyMeta.label}</span>
        <code className="keyrow-prefix mono">{keyMeta.prefix}••••••••</code>
      </div>
      <span className="keyrow-spacer" />
      <button className="btn-danger btn btn-sm" onClick={() => onRevoke(keyMeta.id)}>Revoke</button>
    </li>
  );
}
