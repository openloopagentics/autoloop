import { ScenarioCard } from "./ScenarioCard";
import type { Goal, Scenario, Score, TestRun } from "../types";

export function VisionSection({ goals, scenarios, scores, testRuns }: { goals: Goal[]; scenarios: Scenario[]; scores: Score[]; testRuns: TestRun[] }) {
  if (scenarios.length === 0) return null;
  const byGoal = (gid: string) => scenarios.filter((s) => s.goalId === gid);
  const orphaned = scenarios.filter((s) => !goals.some((g) => g.id === s.goalId));
  return (
    <section>
      <div className="proj-section-head"><h2 className="proj-section-title">Vision</h2></div>
      {goals.map((g) => (
        <div key={g.id} className="goalblock">
          <h3 className="goal-title">{g.title ?? g.id}</h3>
          {g.description && <p className="goal-desc dim">{g.description}</p>}
          <div className="scngrid">{byGoal(g.id).map((s) => <ScenarioCard key={s.id} scenario={s} scores={scores} testRuns={testRuns} />)}</div>
        </div>
      ))}
      {orphaned.length > 0 && (
        <div className="goalblock">
          <h3 className="goal-title dim">Ungrouped</h3>
          <div className="scngrid">{orphaned.map((s) => <ScenarioCard key={s.id} scenario={s} scores={scores} testRuns={testRuns} />)}</div>
        </div>
      )}
    </section>
  );
}
