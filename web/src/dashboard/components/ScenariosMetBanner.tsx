export function ScenariosMetBanner({ met, total }: { met: number; total: number }) {
  const allMet = total > 0 && met === total;
  return (
    <div className={`metbanner card${allMet ? " metbanner--all" : ""}`}>
      <span className="metbanner-num tnum">{met} / {total}</span>
      <span className="metbanner-label">scenarios met</span>
    </div>
  );
}
