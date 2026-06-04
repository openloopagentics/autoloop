import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("harness", () => {
  it("renders with RTL + jsdom", () => {
    render(<p>hello autoloop</p>);
    expect(screen.getByText("hello autoloop")).toBeInTheDocument();
  });
});
