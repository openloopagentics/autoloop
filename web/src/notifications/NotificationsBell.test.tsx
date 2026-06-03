import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Bell, NotificationsList, unreadCount } from "./NotificationsBell";
import type { ReactNode } from "react";
import type { Notification } from "./types";

const wrap = (ui: ReactNode) => <MemoryRouter>{ui}</MemoryRouter>;

const n = (id: string, over: Partial<Notification> = {}): Notification => ({
  id, teamId: "t1", type: "scenario_met", projectSlug: "web", title: `Title ${id}`, message: `Msg ${id}`, ...over,
});

describe("unreadCount", () => {
  it("counts notifications with id > lastSeenId", () => {
    const list = [n("03"), n("02"), n("01")];
    expect(unreadCount(list, "01")).toBe(2);
    expect(unreadCount(list, "03")).toBe(0);
    expect(unreadCount(list, null)).toBe(3); // never seen → all unread
  });
});

describe("NotificationsList", () => {
  it("renders notification titles, or an empty state", () => {
    const { rerender } = render(wrap(<NotificationsList notifications={[n("02"), n("01")]} />));
    expect(screen.getByText("Title 02")).toBeInTheDocument();
    expect(screen.getByText("Title 01")).toBeInTheDocument();
    rerender(wrap(<NotificationsList notifications={[]} />));
    expect(screen.getByText(/no notifications/i)).toBeInTheDocument();
  });
});

describe("Bell", () => {
  it("shows the unread badge and calls onOpen when clicked", () => {
    const onOpen = vi.fn();
    render(wrap(<Bell unread={2} open={false} onOpen={onOpen} notifications={[n("02"), n("01")]} />));
    expect(screen.getByText("2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
  it("hides the badge when there are no unread", () => {
    render(wrap(<Bell unread={0} open={false} onOpen={vi.fn()} notifications={[]} />));
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
  it("renders the dropdown list when open", () => {
    render(wrap(<Bell unread={0} open={true} onOpen={vi.fn()} notifications={[n("01")]} />));
    expect(screen.getByText("Title 01")).toBeInTheDocument();
  });
});
