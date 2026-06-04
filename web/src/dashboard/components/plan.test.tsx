import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TaskItem } from "./TaskItem";

describe("TaskItem live rule", () => {
  it("marks is-live ONLY when isCurrent, regardless of stored status", () => {
    const { container, rerender } = render(<TaskItem task={{ id: "t1", title: "A", status: "running" }} commits={[]} isCurrent />);
    expect(container.querySelector(".sdot.is-live")).not.toBeNull();
    // a non-current task whose stored status is "running" must NOT be live
    rerender(<TaskItem task={{ id: "t2", title: "B", status: "running" }} commits={[]} isCurrent={false} />);
    expect(container.querySelector(".sdot.is-live")).toBeNull();
    // the status dot still reflects stored status
    expect(container.querySelector(".sdot.s-running")).not.toBeNull();
  });
});
