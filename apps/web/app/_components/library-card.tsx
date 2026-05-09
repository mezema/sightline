import Link from "next/link";
import type { InspectionView } from "../../server/types";
import { Pill } from "./pill";
import { ResultStrip } from "./result-strip";
import { formatRelative } from "./relative-date";

export function LibraryCard({ inspection }: { inspection: InspectionView }) {
  const outcome = libraryOutcome(inspection);
  return (
    <Link className="library-card" href={`/i/${inspection.id}`}>
      <div className="library-image">
        <img
          src={inspection.referenceImage.url}
          alt=""
        />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
          <ResultStrip
            counts={{
              total: inspection.targetCount,
              found: inspection.defectCount,
              clean: Math.max(0, inspection.processedCount - inspection.defectCount - inspection.failedCount),
              failed: inspection.failedCount,
            }}
          />
        </div>
      </div>
      <div className="library-caption">
        <strong>{inspection.description || "Untitled inspection"}</strong>
        <div className="meta">
          <Pill state={outcome.state}>{outcome.label}</Pill>
          <span>{formatRelative(inspection.createdAt)}</span>
        </div>
      </div>
    </Link>
  );
}

/**
 * For non-terminal inspections, show lifecycle (running, queued, cancelled).
 * For terminal ones, show outcome (X found, clean, failed). The user's question
 * on the library is "what did we find?" — the pill should answer it directly.
 */
function libraryOutcome(inspection: InspectionView): { state: string; label: string } {
  switch (inspection.status) {
    case "processing":
      return { state: "processing", label: "running" };
    case "queued":
      return { state: "queued", label: "queued" };
    case "cancelled":
      return { state: "cancelled", label: "cancelled" };
    case "draft":
    case "uploading":
      return { state: "draft", label: "draft" };
    case "failed":
      return { state: "failed", label: "all failed" };
    case "completed":
    case "partially_failed": {
      if (inspection.defectCount > 0) {
        return { state: "found", label: `${inspection.defectCount} found` };
      }
      if (inspection.failedCount > 0 && inspection.processedCount > 0) {
        return { state: "failed", label: `${inspection.failedCount} failed` };
      }
      return { state: "clean", label: "clean" };
    }
  }
}
