import { useEffect, useRef } from "react";

/** Growth-replay scrubber. value === null ⇒ live (slider parked at max).
 *  The range input is uncontrolled (synced via ref): a controlled input snaps back to
 *  `value` after each change, and React's value tracker then swallows a re-drag to max —
 *  the "release at max ⇒ live" gesture would never emit. */
export function MapScrubber({ min, max, value, playing, onChange, onPlayPause }: {
  min: number; max: number; value: number | null; playing: boolean;
  onChange: (v: number | null) => void; onPlayPause: () => void;
}) {
  const v = value ?? max;
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.value = String(v); }, [v]);
  return (
    <div className="mapscrub">
      <button type="button" className="mapscrub-play" onClick={onPlayPause}
        aria-label={playing ? "pause" : "play"}>{playing ? "❚❚" : "▶"}</button>
      <input ref={ref} type="range" aria-label="map time scrubber" min={min} max={max} defaultValue={v}
        onChange={(e) => { const n = Number(e.target.value); onChange(n >= max ? null : n); }} />
      <span className="mapscrub-label dim">{value === null ? "live" : new Date(v).toLocaleString()}</span>
    </div>
  );
}
