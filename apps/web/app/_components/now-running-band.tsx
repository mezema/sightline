import Link from "next/link";
import type { InspectionView } from "../../server/types";
import { ResultStrip } from "./result-strip";
import { BandCancel } from "./band-cancel";

export function NowRunningBand({ inspections }: { inspections: InspectionView[] }) {
  if (inspections.length === 0) return null;
  return (
    <section className="now-running" aria-labelledby="now-running-heading">
      <h2 className="section-title" id="now-running-heading">
        <span className="section-pulse">Now running</span>
      </h2>
      <div style={{ display: "grid", gap: 12 }}>
        {inspections.map((inspection) => (
          <article key={inspection.id} className="running-band">
            <Link className="running-band-link" href={`/i/${inspection.id}`}>
              <img src={inspection.referenceImage.url} alt="" />
              <div className="running-band-body">
                <strong>{inspection.description || "Untitled inspection"}</strong>
                <div className="running-band-band">
                  <ResultStrip
                    counts={{
                      total: inspection.targetCount,
                      found: inspection.defectCount,
                      clean: Math.max(0, inspection.processedCount - inspection.defectCount - inspection.failedCount),
                      failed: inspection.failedCount,
                    }}
                  />
                </div>
                <div className="meta">
                  {inspection.processedCount} of {inspection.targetCount} inspected
                  {inspection.defectCount > 0 ? ` · ${inspection.defectCount} found` : ""}
                </div>
              </div>
            </Link>
            <BandCancel inspectionId={inspection.id} />
          </article>
        ))}
      </div>
    </section>
  );
}
