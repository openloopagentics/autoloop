import { ScenariosMetBanner } from "../components/ScenariosMetBanner";
import { VisionSection } from "../components/VisionSection";
import { VisionEditableSection } from "../VisionEditableSection";
import { DocumentsSection } from "../components/DocumentsSection";
import { VisionChangesFeed } from "../components/VisionChangesFeed";
import { VisionWikiTab } from "./VisionWikiTab";
import { summarize } from "../scenarioState";
import { useVisionChanges } from "../hooks";
import { rejectVisionChange } from "../api";
import type { Goal, Scenario, Score, TestRun, DocumentRec, Verification, Page, PageComment } from "../types";

export function VisionTab({ teamId, slug, editable, goals, scenarios, scores, testRuns, documents, verifications, pages, comments, currentUid, isAdmin }: {
  teamId: string; slug: string; editable: boolean;
  goals: Goal[]; scenarios: Scenario[]; scores: Score[]; testRuns: TestRun[]; documents: DocumentRec[]; verifications: Verification[];
  pages: Page[]; comments: PageComment[]; currentUid?: string; isAdmin?: boolean;
}) {
  const hasScenarios = scenarios.length > 0;
  const { met, total } = summarize(scenarios, scores, testRuns, verifications);
  const changes = useVisionChanges(teamId, slug);

  // Living wiki takes over once the loop has published pages; legacy projects (no pages)
  // keep the original list view untouched (spec §4).
  if (pages.length > 0) {
    return (
      <VisionWikiTab teamId={teamId} slug={slug} scenarios={scenarios} scores={scores}
        testRuns={testRuns} verifications={verifications} pages={pages} comments={comments}
        currentUid={currentUid} isAdmin={isAdmin} />
    );
  }

  return (
    <>
      {hasScenarios && <ScenariosMetBanner met={met} total={total} />}
      {editable
        ? <VisionEditableSection teamId={teamId} slug={slug} goals={goals} scenarios={scenarios} scores={scores} testRuns={testRuns} documents={documents} verifications={verifications} />
        : hasScenarios && <VisionSection goals={goals} scenarios={scenarios} scores={scores} testRuns={testRuns} verifications={verifications} />}
      <VisionChangesFeed changes={changes.data} goals={goals} scenarios={scenarios}
        onReject={(changeId) => rejectVisionChange(teamId, slug, changeId)} />
      <DocumentsSection documents={documents} />
    </>
  );
}
