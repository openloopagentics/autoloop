import type { TrendPoint } from "../trendView";
import { polylinePoints } from "../trendView";

const W = 120, H = 32;

/** Compact number label: 1234 → "1.2k", 2500000 → "2.5M". */
function fmt(n: number): string {
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function Sparkline({ label, series, latest, series2 }: {
  label: string; series: (number | null)[]; latest: string; series2?: (number | null)[];
}) {
  const nums = [...series, ...(series2 ?? [])].filter((v): v is number => v !== null);
  const min = nums.length ? Math.min(...nums) : 0;
  const max = nums.length ? Math.max(...nums) : 0;
  return (
    <div className="trend">
      <span className="trend-label">{label}</span>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <polyline points={polylinePoints(series, W, H)} fill="none" strokeWidth="1.5" className="trend-line" />
        {series2 && <polyline points={polylinePoints(series2, W, H)} fill="none" strokeWidth="1.5" className="trend-line trend-line--alt" />}
      </svg>
      <span className="trend-minmax tnum dim">{fmt(min)}–{fmt(max)}</span>
      <span className="trend-latest tnum">{latest}</span>
    </div>
  );
}

/** Cross-loop trend sparklines. Hidden entirely under 2 points (no trend from one
 *  point); the caption labels the bounded window ("last N loops"). */
export function TrendsStrip({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) return null;
  const latest = points[points.length - 1];
  return (
    <section className="trends card">
      <div className="trends-row">
        <Sparkline label="Scenarios met" series={points.map((p) => p.metCount)}
          latest={`${latest.metCount}/${latest.scenarioTotal}`} />
        <Sparkline label="Avg composite" series={points.map((p) => p.avgComposite)}
          latest={latest.avgComposite === null ? "–" : fmt(latest.avgComposite)} />
        <Sparkline label="Bugs" series={points.map((p) => p.bugsOpened)} series2={points.map((p) => p.bugsFixed)}
          latest={`${latest.bugsOpened} open · ${latest.bugsFixed} fixed`} />
        <Sparkline label="Tokens/loop" series={points.map((p) => p.tokensTotal)}
          latest={fmt(latest.tokensTotal)} />
      </div>
      <div className="trends-caption dim">last {points.length} loops</div>
    </section>
  );
}
