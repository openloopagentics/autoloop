import { EmptyState } from "../../dashboard/components/EmptyState";
import type { AccessRequest } from "../types";

export function AccessRequests({
  requests, onApprove, onDeny,
}: {
  requests: AccessRequest[];
  onApprove: (uid: string) => void;
  onDeny: (uid: string) => void;
}) {
  if (requests.length === 0) return <EmptyState message="No pending requests." />;
  return (
    <ul className="userlist card">
      {requests.map((r) => (
        <li key={r.uid} className="userrow">
          <div className="userrow-id">
            <span className="userrow-email">{r.email || r.uid}</span>
            {r.note && <span className="mblock-hint">{r.note}</span>}
            <code className="userrow-uid mono">{r.uid}</code>
          </div>
          <button className="btn btn-sm" onClick={() => onApprove(r.uid)}>Approve</button>
          <button className="btn-danger btn btn-sm" onClick={() => onDeny(r.uid)}>Deny</button>
        </li>
      ))}
    </ul>
  );
}
