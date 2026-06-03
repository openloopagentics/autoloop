import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMyTeams, useTeamNotifications } from "../dashboard/hooks";
import type { TeamRef } from "../dashboard/types";
import type { Notification } from "./types";

const LAST_SEEN_KEY = "daloop:notifs:lastSeen";

/** Number of notifications newer than the last-seen id (ids are sortable ULIDs). */
export function unreadCount(notifications: Notification[], lastSeenId: string | null): number {
  if (lastSeenId === null) return notifications.length;
  return notifications.filter((n) => n.id > lastSeenId).length;
}

function relativeTime(createdAt: unknown): string {
  // Firestore Timestamp has toMillis(); fall back gracefully for other shapes.
  const ms =
    createdAt && typeof (createdAt as { toMillis?: () => number }).toMillis === "function"
      ? (createdAt as { toMillis: () => number }).toMillis()
      : typeof createdAt === "number"
        ? createdAt
        : null;
  if (ms === null) return "";
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

/** Presentational list of notifications (newest first, as passed). */
export function NotificationsList({ notifications }: { notifications: Notification[] }) {
  if (notifications.length === 0) {
    return <div className="notif-empty">No notifications</div>;
  }
  return (
    <ul className="notif-list">
      {notifications.map((n) => (
        <li key={n.id} className="notif-row">
          <Link to={`/dashboard/${n.teamId}/${n.projectSlug}`} className="notif-link">
            <span className="notif-title">{n.title ?? n.type}</span>
            {n.message && <span className="notif-msg">{n.message}</span>}
            <span className="notif-time">{relativeTime(n.createdAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Presentational bell button + dropdown. State lives in the container. */
export function Bell({
  unread,
  open,
  onOpen,
  notifications,
}: {
  unread: number;
  open: boolean;
  onOpen: () => void;
  notifications: Notification[];
}) {
  return (
    <div className="bell">
      <button
        type="button"
        className="bell-btn"
        aria-label="Notifications"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onOpen}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <span className="bell-badge">{unread}</span>}
      </button>
      {open && (
        <div className="notif-dropdown" role="menu">
          <NotificationsList notifications={notifications} />
        </div>
      )}
    </div>
  );
}

/** Per-team subscriber: reports its notifications up to the container. Hooks stay un-looped. */
function TeamNotifs({ teamId, onData }: { teamId: string; onData: (teamId: string, list: Notification[]) => void }) {
  const { data } = useTeamNotifications(teamId);
  useEffect(() => {
    onData(teamId, data.map((n) => ({ ...n, teamId })));
  }, [teamId, data, onData]);
  return null;
}

/** Container: subscribes per-team, merges + sorts, tracks unread via localStorage. */
export function NotificationsBell() {
  const { data: teams } = useMyTeams();
  const [byTeam, setByTeam] = useState<Record<string, Notification[]>>({});
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState<string | null>(() => localStorage.getItem(LAST_SEEN_KEY));
  const ref = useRef<HTMLDivElement>(null);

  const onData = useMemo(
    () => (teamId: string, list: Notification[]) => setByTeam((prev) => ({ ...prev, [teamId]: list })),
    [],
  );

  const notifications = useMemo(() => {
    const teamIds = new Set(teams.map((t) => t.teamId));
    return Object.entries(byTeam)
      .filter(([teamId]) => teamIds.has(teamId))
      .flatMap(([, list]) => list)
      .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  }, [byTeam, teams]);

  const unread = unreadCount(notifications, lastSeen);

  // close on outside-click / Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function toggle() {
    setOpen((wasOpen) => {
      if (!wasOpen && notifications.length > 0) {
        const newest = notifications[0].id;
        localStorage.setItem(LAST_SEEN_KEY, newest);
        setLastSeen(newest); // opening clears the badge
      }
      return !wasOpen;
    });
  }

  return (
    <div ref={ref} className="bell-wrap">
      {teams.map((t: TeamRef) => <TeamNotifs key={t.teamId} teamId={t.teamId} onData={onData} />)}
      <Bell unread={unread} open={open} onOpen={toggle} notifications={notifications} />
    </div>
  );
}
