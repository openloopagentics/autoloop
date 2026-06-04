import { useState } from "react";
import { useSessionLog } from "../hooks";
import type { SessionDoc, SessionEntry } from "../types";

function formatTime(ts: number) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function EntryRow({ entry }: { entry: SessionEntry }) {
  if (entry.kind === "user") {
    return (
      <div className="slog-entry slog-entry--user">
        <span className="slog-role dim">you</span>
        <span className="slog-text">{entry.text}</span>
      </div>
    );
  }
  if (entry.kind === "assistant") {
    return (
      <div className="slog-entry slog-entry--assistant">
        <span className="slog-role">claude</span>
        <span className="slog-text">{entry.text}</span>
      </div>
    );
  }
  return (
    <div className={`slog-entry slog-entry--tool${entry.ok ? "" : " slog-entry--tool-err"}`}>
      <span className="slog-tool-icon">{entry.ok ? "✓" : "✗"}</span>
      <span className="slog-tool-name">{entry.name}</span>
      <span className="slog-tool-summary dim">{entry.summary}</span>
    </div>
  );
}

function SessionBlock({ session, index }: { session: SessionDoc; index: number }) {
  const [showAll, setShowAll] = useState(false);
  const start = formatTime(session.startedAt);
  const end = formatTime(session.endedAt);
  const visible = showAll ? session.entries : session.entries.slice(0, 50);
  const hidden = session.entries.length - 50;
  return (
    <div className="slog-session">
      <div className="slog-session-header dim">
        Session {index + 1} · {start}{end && end !== start ? ` – ${end}` : ""}
      </div>
      {visible.map((e, i) => <EntryRow key={i} entry={e} />)}
      {!showAll && hidden > 0 && (
        <button type="button" className="slog-more dim" onClick={() => setShowAll(true)}>
          {hidden} more entries — show all
        </button>
      )}
    </div>
  );
}

export function SessionLogTab({ teamId, slug, loopId }: { teamId: string; slug: string; loopId: string | undefined }) {
  const { data: sessions, loading, error } = useSessionLog(teamId, slug, loopId);
  if (loading) return <p className="dim">Loading…</p>;
  if (error) return <p className="error-note">{error}</p>;
  if (sessions.length === 0) return <p className="dim">No session log yet — the loop will upload its transcript when it stops.</p>;
  return (
    <div className="slog-wrap">
      {sessions.map((s, i) => <SessionBlock key={s.sessionId} session={s} index={i} />)}
    </div>
  );
}
