import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const putGoal = vi.fn();
const putScenario = vi.fn();
const putDocument = vi.fn();
const deleteGoal = vi.fn();
const deleteScenario = vi.fn();
const deleteDocument = vi.fn();

vi.mock("./api", () => ({
  putGoal: (...a: unknown[]) => putGoal(...a),
  putScenario: (...a: unknown[]) => putScenario(...a),
  putDocument: (...a: unknown[]) => putDocument(...a),
  deleteGoal: (...a: unknown[]) => deleteGoal(...a),
  deleteScenario: (...a: unknown[]) => deleteScenario(...a),
  deleteDocument: (...a: unknown[]) => deleteDocument(...a),
}));

import { VisionEditableSection } from "./VisionEditableSection";

const goals = [{ id: "ship-it", title: "Ship it", description: "ship desc", order: 1 }];
const scenarios = [{
  id: "login", goalId: "ship-it", title: "Login works", description: "scn desc", order: 2, threshold: 80,
  rubric: { criteria: [{ id: "correctness", name: "Correctness", weight: 3, max: 5 }] },
}];
const documents = [{ id: "spec", kind: "spec", title: "Spec", format: "url" as const, content: "https://x/s" }];

function renderSection() {
  return render(
    <VisionEditableSection
      teamId="t1" slug="web"
      goals={goals} scenarios={scenarios} scores={[]} testRuns={[]} documents={documents} />,
  );
}

describe("VisionEditableSection in-place edit", () => {
  beforeEach(() => {
    putGoal.mockReset().mockResolvedValue(undefined);
    putScenario.mockReset().mockResolvedValue(undefined);
    putDocument.mockReset().mockResolvedValue(undefined);
    deleteGoal.mockReset().mockResolvedValue(undefined);
    deleteScenario.mockReset().mockResolvedValue(undefined);
    deleteDocument.mockReset().mockResolvedValue(undefined);
  });

  it("edits a goal pre-filled, submitting putGoal with the existing id", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /edit goal ship-it/i }));
    const title = screen.getByLabelText(/goal title/i) as HTMLInputElement;
    expect(title.value).toBe("Ship it");
    fireEvent.change(title, { target: { value: "Ship it v2" } });
    fireEvent.click(screen.getByRole("button", { name: /save goal/i }));
    await waitFor(() => expect(putGoal).toHaveBeenCalledWith(
      "t1", "web", "ship-it", expect.objectContaining({ title: "Ship it v2" }),
    ));
  });

  it("edits a scenario pre-filled, submitting putScenario with the existing id", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /edit scenario login/i }));
    const title = screen.getByLabelText(/scenario title/i) as HTMLInputElement;
    expect(title.value).toBe("Login works");
    expect((screen.getByLabelText(/criterion 1 name/i) as HTMLInputElement).value).toBe("Correctness");
    fireEvent.click(screen.getByRole("button", { name: /save scenario/i }));
    await waitFor(() => expect(putScenario).toHaveBeenCalledWith(
      "t1", "web", "login",
      expect.objectContaining({ title: "Login works", goalId: "ship-it" }),
    ));
  });

  it("edits a document pre-filled, submitting putDocument with the existing id", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /edit document spec/i }));
    const title = screen.getByLabelText(/document title/i) as HTMLInputElement;
    expect(title.value).toBe("Spec");
    fireEvent.click(screen.getByRole("button", { name: /save document/i }));
    await waitFor(() => expect(putDocument).toHaveBeenCalledWith(
      "t1", "web", "spec", expect.objectContaining({ title: "Spec", format: "url" }),
    ));
  });

  it("only one edit form is open at a time", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /edit goal ship-it/i }));
    expect(screen.getByLabelText(/goal title/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /edit document spec/i }));
    expect(screen.queryByLabelText(/goal title/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/document title/i)).toBeInTheDocument();
  });

  it("shows the ✓ verification badge when the latest test-run is confirmed", () => {
    render(
      <VisionEditableSection
        teamId="t1" slug="web"
        goals={goals} scenarios={scenarios} documents={documents}
        scores={[{ id: "01A", scenarioId: "login", composite: 92 }]}
        testRuns={[{ id: "01A", scenarioId: "login", passed: 6, failed: 0 }]}
        verifications={[{ id: "01V", scenarioId: "login", testRunId: "01A", verdict: "confirmed" }]} />,
    );
    expect(screen.getByTitle("Independently verified")).toHaveTextContent("✓");
  });
});
