import SwiftUI

/// Mirrors a `.msg` row in MessagesTab.tsx: author-styled bubble with relative
/// time and (for user messages) a Sent/Delivered status.
struct MessageBubble: View {
    let message: Message

    private var isUser: Bool { message.author == "user" }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 40) }
            VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
                Text(message.text)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(isUser ? Color.accentColor.opacity(0.18) : Color(.secondarySystemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                HStack(spacing: 8) {
                    if let time = relativeTime(message.createdAt) {
                        Text(time)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    if isUser, let status = message.status {
                        Text(status == "pending" ? "Sent" : "Delivered")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            if !isUser { Spacer(minLength: 40) }
        }
    }
}

/// just now / Xm ago / Xh ago / Xd ago. Returns nil when there's no date.
func relativeTime(_ date: Date?) -> String? {
    guard let date else { return nil }
    let diff = Date().timeIntervalSince(date)
    let min = Int((diff / 60).rounded())
    if min < 1 { return "just now" }
    if min < 60 { return "\(min)m ago" }
    let hr = Int((Double(min) / 60).rounded())
    if hr < 24 { return "\(hr)h ago" }
    return "\(Int((Double(hr) / 24).rounded()))d ago"
}
