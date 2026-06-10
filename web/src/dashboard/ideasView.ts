import type { Idea } from "./types";

/** Band ranks: the user's queue first, then the loop's proposals, then the vetoed, then the shipped. */
const BAND: Record<string, number> = { accepted: 0, proposed: 1, rejected: 2, done: 3 };

const millis = (v: unknown): number => {
  const t = v as { toMillis?: () => number } | null | undefined;
  return t?.toMillis ? t.toMillis() : Number.MAX_SAFE_INTEGER;
};

/** Band-sort: accepted → proposed → rejected → done, then order, then createdAt. Pure; does not mutate. */
export function sortIdeas(ideas: Idea[]): Idea[] {
  return [...ideas].sort((a, b) =>
    ((BAND[a.status ?? "proposed"] ?? 9) - (BAND[b.status ?? "proposed"] ?? 9))
    || ((a.order ?? 0) - (b.order ?? 0))
    || (millis(a.createdAt) - millis(b.createdAt)));
}

/**
 * The PUT writes needed to move `id` one step up/down WITHIN its status band.
 * When the band has duplicate orders (e.g. several CLI defaults of 100), the whole
 * band is renumbered 10, 20, 30, … before the swap, so reorder is never a silent no-op.
 * Returns [] at a band edge or for an unknown id. Emits only changed orders.
 */
export function moveIdea(ideas: Idea[], id: string, dir: "up" | "down"): { id: string; order: number }[] {
  const me = ideas.find((i) => i.id === id);
  if (!me) return [];
  const band = sortIdeas(ideas).filter((i) => (i.status ?? "proposed") === (me.status ?? "proposed"));
  const idx = band.findIndex((i) => i.id === id);
  const j = dir === "up" ? idx - 1 : idx + 1;
  if (j < 0 || j >= band.length) return [];
  const orders = band.map((i) => i.order ?? 0);
  const hasTies = new Set(orders).size !== orders.length;
  const next = band.map((i, k) => ({ id: i.id, order: hasTies ? (k + 1) * 10 : (i.order ?? 0) }));
  [next[idx].order, next[j].order] = [next[j].order, next[idx].order];
  return next.filter((w, k) => w.order !== (band[k].order ?? 0));
}

/** Derive an ideaId from a title: slugify, then append a short random suffix on collision. */
export function ideaIdFor(
  title: string,
  taken: Set<string>,
  rand: () => string = () => Math.random().toString(36).slice(2, 6),
): string {
  const slug = title.toLowerCase().trim().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "idea";
  return taken.has(slug) ? `${slug}-${rand()}` : slug;
}
