import SwiftUI

/// Mirrors MessagesTab.tsx: segmented control (Messages | Session Log).
/// Messages = thread + agent-active hint + compose. Session Log = grouped sessions.
struct MessagesTabView: View {
    @ObservedObject var store: ProjectDetailStore
    @StateObject private var tabStore = MessagesTabStore()

    private enum Segment: Hashable { case messages, log }
    @State private var segment: Segment = .messages
    @State private var draft = ""
    @State private var sending = false

    private var messages: [Message] { tabStore.messages.data }

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $segment) {
                Text("Messages").tag(Segment.messages)
                Text("Session Log").tag(Segment.log)
            }
            .pickerStyle(.segmented)
            .padding()

            switch segment {
            case .messages: messagesSegment
            case .log:      SessionLogView(sessionsByScope: tabStore.sessionsByScope)
            }
        }
        .onAppear {
            tabStore.start(teamId: store.teamId, slug: store.slug, loops: store.loops.data)
        }
        .onChange(of: store.loops.data.map(\.id)) { _ in
            tabStore.subscribeSessions(loops: store.loops.data)
        }
        .onDisappear {
            tabStore.stop()
        }
    }

    // MARK: - Messages segment

    private var messagesSegment: some View {
        VStack(spacing: 0) {
            thread

            if let err = tabStore.sendError {
                ErrorNote(message: err)
            }

            Text(store.agentActive
                 ? "A loop is running — it'll see your message at its next step."
                 : "No active run — your message will wait until a loop starts.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal)
                .padding(.top, 4)

            composeRow
        }
    }

    private var thread: some View {
        Group {
            if messages.isEmpty {
                if tabStore.messages.loading && messages.isEmpty {
                    HStack { Spacer(); Spinner(); Spacer() }
                } else {
                    EmptyState(text: "No messages yet")
                }
            } else {
                ScrollView {
                    VStack(spacing: 10) {
                        ForEach(messages) { msg in
                            MessageBubble(message: msg)
                        }
                    }
                    .padding()
                }
            }
        }
        .frame(maxHeight: .infinity)
    }

    private var composeRow: some View {
        HStack(spacing: 8) {
            TextField("Send a message to the agent…", text: $draft, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...4)
                .disabled(sending)
            Button(sending ? "Sending…" : "Send") { send() }
                .buttonStyle(.borderedProminent)
                .disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding()
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        sending = true
        Task {
            await tabStore.send(text: text)
            sending = false
            // On success (no error), clear the field; the live listener shows the message.
            if tabStore.sendError == nil { draft = "" }
        }
    }
}
