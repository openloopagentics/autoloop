import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("harness", () => {
  it("renders with RTL + jsdom", () => {
    render(<p>hello daloop</p>);
    expect(screen.getByText("hello daloop")).toBeInTheDocument();
  });
});
