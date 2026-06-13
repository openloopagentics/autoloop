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
                    let time = relativeTime(message.createdAt)
                    if !time.isEmpty {
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
