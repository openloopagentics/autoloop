import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MessagesTab } from "../tabs/MessagesTab";
import type { Message } from "../types";

const userMsg: Message = { id: "m1", text: "Hello agent", author: "user", status: "pending" };
const deliveredMsg: Message = { id: "m2", text: "Done now", author: "user", status: "delivered" };
const agentMsg: Message = { id: "m3", text: "I will handle it", author: "agent" };

describe("MessagesTab", () => {
  it("renders user bubble with msg--user class", () => {
    const { container } = render(<MessagesTab teamId="t1" slug="p1" loopId="loop1" messages={[userMsg]} onSend={vi.fn()} />);
    const userBubble = container.querySelector(".msg--user");
    expect(userBubble).not.toBeNull();
    expect(userBubble?.textContent).toContain("Hello agent");
  });

  it("renders agent bubble with msg--agent class", () => {
    const { container } = render(<MessagesTab teamId="t1" slug="p1" loopId="loop1" messages={[agentMsg]} onSend={vi.fn()} />);
    const agentBubble = container.querySelector(".msg--agent");
    expect(agentBubble).not.toBeNull();
    expect(agentBubble?.textContent).toContain("I will handle it");
  });

  it("shows pending pill on user message with status=pending", () => {
    const { container } = render(<MessagesTab teamId="t1" slug="p1" loopId="loop1" messages={[userMsg]} onSend={vi.fn()} />);
    const pill = container.querySelector(".msgstatus--pending");
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toMatch(/sent/i);
  });

  it("shows delivered pill on user message with status=delivered", () => {
    const { container } = render(<MessagesTab teamId="t1" slug="p1" loopId="loop1" messages={[deliveredMsg]} onSend={vi.fn()} />);
    const pill = container.querySelector(".msgstatus--delivered");
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toMatch(/delivered/i);
  });

  it("does NOT render a status pill on agent messages", () => {
    const { container } = render(<MessagesTab teamId="t1" slug="p1" loopId="loop1" messages={[agentMsg]} onSend={vi.fn()} />);
    expect(container.querySelector(".msgstatus")).toBeNull();
  });

  it("shows empty state when messages array is empty", () => {
    render(<MessagesTab teamId="t1" slug="p1" loopId="loop1" messages={[]} onSend={vi.fn()} />);
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
  });

  it("calls onSend with the typed text and clears on success", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<MessagesTab teamId="t1" slug="p1" loopId="loop1" messages={[]} onSend={onSend} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "new message" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("new message"));
    await waitFor(() => expect((textarea as HTMLTextAreaElement).value).toBe(""));
  });

  it("shows an error via ErrorNote when onSend rejects", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("network failure"));
    render(<MessagesTab teamId="t1" slug="p1" loopId="loop1" messages={[]} onSend={onSend} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toMatch(/network failure/i);
  });

  it("does not call onSend for empty/whitespace-only text", () => {
    const onSend = vi.fn();
    render(<MessagesTab teamId="t1" slug="p1" loopId="loop1" messages={[]} onSend={onSend} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows running hint when agentActive=true", () => {
    const { container } = render(<MessagesTab teamId="t1" slug="p1" loopId="loop1" messages={[]} onSend={vi.fn()} agentActive={true} />);
    expect(container.querySelector(".msg-agentstatus--active")).not.toBeNull();
    expect(screen.getByText(/a loop is running/i)).toBeInTheDocument();
    expect(screen.getByText(/it'll see your message at its next step/i)).toBeInTheDocument();
  });

  it("shows waiting hint when agentActive=false", () => {
    const { container } = render(<MessagesTab teamId="t1" slug="p1" loopId="loop1" messages={[]} onSend={vi.fn()} agentActive={false} />);
    const el = container.querySelector(".msg-agentstatus");
    expect(el).not.toBeNull();
    expect(el?.classList.contains("msg-agentstatus--active")).toBe(false);
    expect(screen.getByText(/no active run/i)).toBeInTheDocument();
    expect(screen.getByText(/your message will wait until a loop starts/i)).toBeInTheDocument();
  });

  it("omits the agent-status hint when agentActive is not passed", () => {
    const { container } = render(<MessagesTab teamId="t1" slug="p1" loopId="loop1" messages={[]} onSend={vi.fn()} />);
    expect(container.querySelector(".msg-agentstatus")).toBeNull();
  });
});
