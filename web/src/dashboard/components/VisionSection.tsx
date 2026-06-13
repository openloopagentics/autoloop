import { ScenarioTable } from "./ScenarioTable";
import type { Goal, Scenario, Score, TestRun, Verification } from "../types";

export function VisionSection({ goals, scenarios, scores, testRuns, verifications = [] }: { goals: Goal[]; scenarios: Scenario[]; scores: Score[]; testRuns: TestRun[]; verifications?: Verification[] }) {
  if (scenarios.length === 0) return null;
  const byGoal = (gid: string) => scenarios.filter((s) => s.goalId === gid);
  const orphaned = scenarios.filter((s) => !goals.some((g) => g.id === s.goalId));
  return (
    <section>
      <div className="proj-section-head"><h2 className="proj-section-title">Vision</h2></div>
      {goals.map((g) => {
        const items = byGoal(g.id);
        if (items.length === 0) return null;
        return (
          <div key={g.id} className="goalblock">
            <h3 className="goal-title">{g.title ?? g.id}</h3>
            {g.description && <p className="goal-desc dim">{g.description}</p>}
            <ScenarioTable scenarios={items} scores={scores} testRuns={testRuns} verifications={verifications} />
          </div>
        );
      })}
      {orphaned.length > 0 && (
        <div className="goalblock">
          <h3 className="goal-title dim">Ungrouped</h3>
          <ScenarioTable scenarios={orphaned} scores={scores} testRuns={testRuns} verifications={verifications} />
        </div>
      )}
    </section>
  );
}
