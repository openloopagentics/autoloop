import { KeyRow } from "./KeyRow";
import { EmptyState } from "../../dashboard/components/EmptyState";
import type { KeyMeta } from "../types";
export function KeyList({ keys, onRevoke }: { keys: KeyMeta[]; onRevoke: (id: string) => void }) {
  if (keys.length === 0) return <EmptyState message="No API keys yet — create one for your agents." />;
  return <ul>{keys.map((k) => <KeyRow key={k.id} keyMeta={k} onRevoke={onRevoke} />)}</ul>;
}
