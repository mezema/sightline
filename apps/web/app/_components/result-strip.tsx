type Counts = {
  total: number;
  found: number;
  clean: number;
  failed: number;
};

export function ResultStrip({ counts }: { counts: Counts }) {
  const total = Math.max(1, counts.total);
  const remaining = Math.max(0, counts.total - counts.found - counts.clean - counts.failed);
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="result-strip" aria-label={`${counts.found} found, ${counts.clean} clean, ${counts.failed} failed, ${remaining} remaining`}>
      {counts.found > 0 ? <span className="seg seg-found" style={{ width: pct(counts.found) }} /> : null}
      {counts.clean > 0 ? <span className="seg seg-clean" style={{ width: pct(counts.clean) }} /> : null}
      {counts.failed > 0 ? <span className="seg seg-failed" style={{ width: pct(counts.failed) }} /> : null}
      {remaining > 0 ? <span className="seg seg-remaining" style={{ width: pct(remaining) }} /> : null}
    </div>
  );
}
