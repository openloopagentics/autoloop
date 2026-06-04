import { useState } from "react";
import { ErrorNote } from "../components/ErrorNote";
import type { Message } from "../types";

/** Matches the non-exported relativeTime in NotificationsBell.tsx. */
function relativeTime(createdAt: unknown): string {
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

export function MessagesTab({
  messages,
  onSend,
  agentActive,
}: {
  messages: Message[];
  onSend: (text: string) => Promise<void>;
  agentActive?: boolean;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  async function handleSend() {
    if (!text.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      await onSend(text.trim());
      setText("");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="msgthread-wrap">
      <div className="msgthread">
        {messages.length === 0 ? (
          <p className="msgthread-empty">No messages yet</p>
        ) : (
          <ul className="msglist">
            {messages.map((msg) => (
              <li key={msg.id} className={`msg msg--${msg.author}`}>
                <span className="msg-text">{msg.text}</span>
                {msg.createdAt !== undefined && (
                  <span className="msg-time dim tnum">{relativeTime(msg.createdAt)}</span>
                )}
                {msg.author === "user" && msg.status !== undefined && (
                  <span className={`msgstatus msgstatus--${msg.status}`}>
                    {msg.status === "pending" ? "Sent" : "Delivered"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {sendError && <ErrorNote message={sendError} />}

      {agentActive !== undefined && (
        <p className={`msg-agentstatus${agentActive ? " msg-agentstatus--active" : ""}`}>
          {agentActive
            ? "A loop is running — it'll see your message at its next step."
            : "No active run — your message will wait until a loop starts."}
        </p>
      )}

      <div className="msgcompose">
        <textarea
          className="msgcompose-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Send a message to the agent…"
          rows={3}
          disabled={sending}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <button
          type="button"
          className="btn btn--primary msgcompose-send"
          onClick={() => void handleSend()}
          disabled={sending || !text.trim()}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
