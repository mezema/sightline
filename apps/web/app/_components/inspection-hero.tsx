import type { InspectionView } from "../../server/types";
import { Pill } from "./pill";
import { CancelControl } from "./cancel-control";
import { DeleteControl } from "./delete-control";

const TERMINAL_STATUSES = new Set(["completed", "failed", "partially_failed", "cancelled"]);

export function InspectionHero({ inspection, summary }: {
  inspection: InspectionView;
  summary: { processed: number; total: number; defect: number; failed: number };
}) {
  const cancellable = inspection.status === "processing" || inspection.status === "queued";
  const deletable = TERMINAL_STATUSES.has(inspection.status);
  return (
    <div className="hero">
      <div className="hero-reference" data-state="filled">
        <img
          src={inspection.referenceImage.url}
          alt=""
        />
      </div>
      <div className="hero-text">
        <h1 className="hero-description">{inspection.description}</h1>
        <div className="hero-meta">
          <Pill state={inspection.status} />
          <strong>{summary.processed} of {summary.total} inspected</strong>
          {summary.defect > 0 ? <strong>{summary.defect} found</strong> : null}
          {summary.failed > 0 ? <strong>{summary.failed} failed</strong> : null}
        </div>
        {cancellable ? <CancelControl inspectionId={inspection.id} /> : null}
        {deletable ? <DeleteControl inspectionId={inspection.id} /> : null}
      </div>
    </div>
  );
}
