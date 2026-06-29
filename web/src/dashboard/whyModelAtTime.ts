import { buildWhyModel, type BuildWhyModelInput, type WhyModel } from "./whyModel";

export function tsMillis(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (v && typeof (v as { toMillis?: () => number }).toMillis === "function") return (v as { toMillis: () => number }).toMillis();
  return null;
}
const within = (cutoff: number) => (e: { createdAt?: unknown }) => { const t = tsMillis(e.createdAt); return t === null || t <= cutoff; };

/** The why-model as of time `cutoff`: timestamped records filtered to createdAt <= cutoff;
 *  vision (goals/scenarios) and ideas stay present. Then buildWhyModel over the slice. */
export function whyModelAtTime(input: BuildWhyModelInput, cutoff: number): WhyModel {
  const w = within(cutoff);
  return buildWhyModel({
    ...input,
    scores: input.scores.filter(w),
    testRuns: input.testRuns.filter(w),
    verifications: input.verifications.filter(w),
    decisions: input.decisions.filter(w),
    revisions: input.revisions.filter(w),
    visionChanges: input.visionChanges.filter(w),
    tasks: input.tasks.filter(w),
    bugs: input.bugs.filter(w),
  });
}
