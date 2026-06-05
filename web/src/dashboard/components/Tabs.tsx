export type TabKey = "dashboard" | "vision" | "loops" | "tests" | "bugs" | "messages";

const TABS: { key: TabKey; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "vision", label: "Vision" },
  { key: "loops", label: "Loops" },
  { key: "tests", label: "Tests" },
  { key: "bugs", label: "Bugs" },
  { key: "messages", label: "Messages" },
];

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
