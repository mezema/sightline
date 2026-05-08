import type { InspectionView, ReviewTargetView } from "../../server/types";
import { DetailActions } from "./detail-actions";

export function DetailContent({
  inspection,
  target,
  feedback,
}: {
  inspection: InspectionView;
  target: ReviewTargetView;
  index?: number;
  feedback?: { kind: "correct" | "wrong" };
}) {
  const isFailed = target.bucket === "failed";
  const isDefect = target.bucket === "defect";
  const attempt = target.latestAttempt;
  const latencyMs = attempt?.startedAt && attempt?.completedAt
    ? new Date(attempt.completedAt).getTime() - new Date(attempt.startedAt).getTime()
    : undefined;

  const status = isDefect ? "Defect found"
    : isFailed ? "Failed"
    : target.bucket === "running" ? "Inspecting"
    : target.bucket === "queued" ? "Queued"
    : "Clean";

  return (
    <div className="sheet-body">
      <div className="sheet-image">
        <SheetImage target={target} />
      </div>
      <aside className="sheet-side">
        <div className="field">
          <span className="field-label">Result</span>
          <h2>{status}</h2>
        </div>
        <div className="field">
          <span className="field-label">File</span>
          <span className="field-value mono">{target.image.originalFilename}</span>
        </div>
        {latencyMs != null ? (
          <div className="field">
            <span className="field-label">Latency</span>
            <span className="field-value">{(latencyMs / 1000).toFixed(1)}s</span>
          </div>
        ) : null}
        {isFailed && attempt?.lastError ? (
          <div className="field">
            <span className="field-label">Reason</span>
            <span className="field-value">{attempt.lastError}</span>
          </div>
        ) : null}
        {target.detections.length > 0 ? (
          <div className="field">
            <span className="field-label">Detections</span>
            <ul className="detection-list">
              {target.detections.map((d, i) => (
                <li key={d.id ?? i}>
                  <strong>{d.label || `Detection ${i + 1}`}</strong>
                  {d.reason ? <span>{d.reason}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <DetailActions
          inspectionId={inspection.id}
          targetId={target.id}
          isFailed={isFailed}
          currentFeedback={feedback?.kind}
        />
      </aside>
    </div>
  );
}

function SheetImage({ target }: { target: ReviewTargetView }) {
  const w = target.image.width || 1024;
  const h = target.image.height || 768;
  return (
    <div className="sheet-image-wrap" style={{ aspectRatio: `${w} / ${h}` }}>
      <img src={target.image.url} alt={target.image.originalFilename} />
      <svg
        className="overlay"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {target.detections.map((d) => {
          const bw = Math.max(1, d.x2 - d.x1);
          const bh = Math.max(1, d.y2 - d.y1);
          return (
            <g key={d.id}>
              <rect className="overlay-halo" x={d.x1} y={d.y1} width={bw} height={bh} />
              <rect className="overlay-box" x={d.x1} y={d.y1} width={bw} height={bh} />
              {d.label ? <text x={d.x1 + 4} y={d.y1 + 14}>{d.label}</text> : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
