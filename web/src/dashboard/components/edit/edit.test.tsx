import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GoalForm } from "./GoalForm";
import { ScenarioForm } from "./ScenarioForm";

describe("GoalForm", () => {
  it("submits title + order via onSave and clears", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<GoalForm onSave={onSave} />);
    fireEvent.change(screen.getByPlaceholderText(/goal title/i), { target: { value: "Ship" } });
    fireEvent.click(screen.getByRole("button", { name: /add goal/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: "Ship" })));
    await waitFor(() => expect((screen.getByPlaceholderText(/goal title/i) as HTMLInputElement).value).toBe(""));
  });
  it("disables submit when title is empty", () => {
    render(<GoalForm onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: /add goal/i })).toBeDisabled();
  });
  it("shows an error when onSave rejects", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("nope"));
    render(<GoalForm onSave={onSave} />);
    fireEvent.change(screen.getByPlaceholderText(/goal title/i), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: /add goal/i }));
    await waitFor(() => expect(screen.getByText(/nope/)).toBeInTheDocument());
  });
});

describe("ScenarioForm", () => {
  const goals = [{ id: "g1", title: "G" }];

  it("submits goalId, title and rubric criteria", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ScenarioForm goals={goals} onSave={onSave} />);
    fireEvent.change(screen.getByPlaceholderText(/scenario title/i), { target: { value: "Login" } });
    // a first criterion row exists by default
    fireEvent.change(screen.getByLabelText(/criterion 1 name/i), { target: { value: "Correctness" } });
    fireEvent.change(screen.getByLabelText(/criterion 1 weight/i), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/criterion 1 max/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /add scenario/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      goalId: "g1",
      title: "Login",
      rubric: { criteria: [expect.objectContaining({ id: expect.stringMatching(/^[a-z0-9._-]+$/), name: "Correctness", weight: 3, max: 5 })] },
    })));
  });

  it("can add and remove criterion rows", () => {
    render(<ScenarioForm goals={goals} onSave={vi.fn()} />);
    expect(screen.getByLabelText(/criterion 1 name/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add criterion/i }));
    expect(screen.getByLabelText(/criterion 2 name/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove criterion 2/i }));
    expect(screen.queryByLabelText(/criterion 2 name/i)).not.toBeInTheDocument();
  });

  it("disables submit with empty title", () => {
    render(<ScenarioForm goals={goals} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/criterion 1 name/i), { target: { value: "C" } });
    fireEvent.change(screen.getByLabelText(/criterion 1 weight/i), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/criterion 1 max/i), { target: { value: "5" } });
    expect(screen.getByRole("button", { name: /add scenario/i })).toBeDisabled();
  });

  it("disables submit with no valid criteria", () => {
    render(<ScenarioForm goals={goals} onSave={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/scenario title/i), { target: { value: "Login" } });
    // criterion left blank → invalid
    expect(screen.getByRole("button", { name: /add scenario/i })).toBeDisabled();
  });
});
