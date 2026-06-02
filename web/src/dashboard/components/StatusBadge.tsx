import { statusColor } from "../status";
export function StatusBadge({ status }: { status: string }) {
  return <span data-color={statusColor(status)} className={`badge badge-${statusColor(status)}`}>{status}</span>;
}
