import { ScenariosMetBanner } from "../components/ScenariosMetBanner";
import { VisionSection } from "../components/VisionSection";
import { VisionEditableSection } from "../VisionEditableSection";
import { DocumentsSection } from "../components/DocumentsSection";
import { summarize } from "../scenarioState";
import type { Goal, Scenario, Score, TestRun, DocumentRec, Verification } from "../types";

export function VisionTab({ teamId, slug, editable, goals, scenarios, scores, testRuns, documents, verifications }: {
  teamId: string; slug: string; editable: boolean;
  goals: Goal[]; scenarios: Scenario[]; scores: Score[]; testRuns: TestRun[]; documents: DocumentRec[]; verifications: Verification[];
}) {
  const hasScenarios = scenarios.length > 0;
  const { met, total } = summarize(scenarios, scores, testRuns);
  return (
    <>
      {hasScenarios && <ScenariosMetBanner met={met} total={total} />}
      {editable
        ? <VisionEditableSection teamId={teamId} slug={slug} goals={goals} scenarios={scenarios} scores={scores} testRuns={testRuns} documents={documents} verifications={verifications} />
        : hasScenarios && <VisionSection goals={goals} scenarios={scenarios} scores={scores} testRuns={testRuns} verifications={verifications} />}
      <DocumentsSection documents={documents} />
    </>
  );
}
