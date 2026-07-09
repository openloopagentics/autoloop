export type TabKey = "dashboard" | "vision" | "loops" | "tests" | "bugs" | "map" | "ideas" | "messages";

const TABS: { key: TabKey; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "vision", label: "Vision" },
  { key: "loops", label: "Loops" },
  { key: "tests", label: "Tests" },
  { key: "bugs", label: "Bugs" },
  { key: "map", label: "Map" },
  { key: "ideas", label: "Ideas" },
  { key: "messages", label: "Messages" },
];

export const TAB_KEYS = TABS.map((t) => t.key);
export function isTabKey(v: string | undefined): v is TabKey {
  return v !== undefined && (TAB_KEYS as string[]).includes(v);
}

/**
 * The vision wiki is a three-column reader that needs the full-width container; every
 * other tab (and the legacy vision list, which has no pages) keeps the narrow measure.
 */
export function wikiWideLayout(tab: TabKey, hasPages: boolean): boolean {
  return tab === "vision" && hasPages;
}

export function Tabs({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  return (
    <div className="tabbar" role="tablist">
      {TABS.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={active === t.key}
          className={`tab${active === t.key ? " tab--active" : ""}`} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
