import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { processScenarioEvent, processProjectStatusChange, processAgentMessage } from "./notifier.js";

const region = "us-central1";

export const onScoreWritten = onDocumentWritten({ document: "teams/{teamId}/projects/{slug}/scores/{id}", region }, async (event) => {
  try {
    const { teamId, slug } = event.params as { teamId: string; slug: string };
    const scenarioId = (event.data?.after?.data()?.scenarioId ?? event.data?.before?.data()?.scenarioId) as string | undefined;
    if (scenarioId) await processScenarioEvent(teamId, slug, scenarioId);
  } catch (e) {
    console.error("notify trigger:", (e as Error).message);
  }
});

export const onTestRunWritten = onDocumentWritten({ document: "teams/{teamId}/projects/{slug}/testRuns/{id}", region }, async (event) => {
  try {
    const { teamId, slug } = event.params as { teamId: string; slug: string };
    const scenarioId = (event.data?.after?.data()?.scenarioId ?? event.data?.before?.data()?.scenarioId) as string | undefined;
    if (scenarioId) await processScenarioEvent(teamId, slug, scenarioId);
  } catch (e) {
    console.error("notify trigger:", (e as Error).message);
  }
});

export const onProjectStatusWritten = onDocumentWritten({ document: "teams/{teamId}/projects/{slug}", region }, async (event) => {
  try {
    const { teamId, slug } = event.params as { teamId: string; slug: string };
    const before = event.data?.before?.data()?.status as string | undefined;
    const after = event.data?.after?.data()?.status as string | undefined;
    await processProjectStatusChange(teamId, slug, before, after);
  } catch (e) {
    console.error("notify trigger:", (e as Error).message);
  }
});

export const onMessageWritten = onDocumentWritten({ document: "teams/{teamId}/projects/{slug}/messages/{id}", region }, async (event) => {
  try {
    // Only fire on create (not update/delete) AND only when author is "agent"
    if (!(!event.data?.before?.exists && event.data?.after?.exists)) return;
    const afterData = event.data?.after?.data();
    if (afterData?.author !== "agent") return;
    const { teamId, slug } = event.params as { teamId: string; slug: string };
    await processAgentMessage(teamId, slug, afterData.text as string);
  } catch (e) {
    console.error("notify trigger:", (e as Error).message);
  }
});
