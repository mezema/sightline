import Link from "next/link";
import type { ReviewTargetView } from "../../server/types";

export function Tile({
  target,
  href,
  feedback,
}: {
  target: ReviewTargetView;
  href: string;
  feedback?: { kind: "correct" | "wrong" };
}) {
  const state = target.latestAttempt?.status === "cancelled" ? "cancelled" : mapBucketToState(target.bucket);
  const showImage = state !== "queued";
  return (
    <Link className="tile" data-state={state} href={href}>
      <div className="tile-image">
        {showImage ? (
          <>
            <img
              src={target.image.url}
              alt=""
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
            <svg
              className="overlay"
              viewBox={`0 0 ${target.image.width || 256} ${target.image.height || 180}`}
              preserveAspectRatio="xMidYMid slice"
              aria-hidden="true"
            >
              {target.detections.map((d) => {
                const w = Math.max(1, d.x2 - d.x1);
                const h = Math.max(1, d.y2 - d.y1);
                return (
                  <g key={d.id}>
                    <rect className="overlay-halo" x={d.x1} y={d.y1} width={w} height={h} />
                    <rect className="overlay-box" x={d.x1} y={d.y1} width={w} height={h} />
                  </g>
                );
              })}
            </svg>
          </>
        ) : null}
      </div>
      <div className="tile-meta">
        <span className="tile-name">{target.image.originalFilename}</span>
        <span className="tile-status">
          {tileStatusLabel(target)}
          {feedback ? (
            <span className="tile-mark" data-mark={feedback.kind}>
              {feedback.kind === "correct" ? "Correct" : "Wrong"}
            </span>
          ) : null}
        </span>
      </div>
    </Link>
  );
}

function mapBucketToState(bucket: ReviewTargetView["bucket"]) {
  if (bucket === "queued") return "queued";
  if (bucket === "running") return "running";
  if (bucket === "defect") return "defect";
  if (bucket === "failed") return "failed";
  return "clean";
}

function tileStatusLabel(target: ReviewTargetView) {
  if (target.latestAttempt?.status === "cancelled") return "Skipped";
  if (target.bucket === "queued") return "Queued";
  if (target.bucket === "running") return "Inspecting…";
  if (target.bucket === "failed") return "Could not inspect";
  if (target.bucket === "defect") {
    const n = target.detections.length;
    return `${n} detection${n === 1 ? "" : "s"}`;
  }
  return "Clean";
}
