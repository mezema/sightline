import Link from "next/link";
import type { InspectionView } from "../../server/types";
import { Pill } from "./pill";
import { ResultStrip } from "./result-strip";
import { formatRelative } from "./relative-date";

export function LibraryCard({ inspection }: { inspection: InspectionView }) {
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
          <Pill state={inspection.status} />
          <span>{formatRelative(inspection.createdAt)}</span>
        </div>
      </div>
    </Link>
  );
}
