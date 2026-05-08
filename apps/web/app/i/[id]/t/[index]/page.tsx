import Link from "next/link";
import { notFound } from "next/navigation";
import type { Feedback } from "@sightline/core";
import { getInspectionRepository } from "../../../../../server/repository";
import { buildReview, summarizeInspection } from "../../../../../server/review";
import { DetailContent } from "../../../../_components/detail-content";
import { InspectionHero } from "../../../../_components/inspection-hero";

export const dynamic = "force-dynamic";

export default async function FullDetailPage({
  params,
}: {
  params: Promise<{ id: string; index: string }>;
}) {
  const { id, index } = await params;
  const inspection = await getInspectionRepository().getInspection(id);
  if (!inspection) notFound();

  const review = buildReview(inspection);
  const summary = summarizeInspection(inspection);
  const idx = Number(index);
  const target = review.targets[idx];
  if (!target) notFound();

  const feedbackEntry = inspection.feedback.find(
    (f: Feedback) => f.subjectType === "target" && f.inspectionTargetId === target.id,
  );
  const feedback = feedbackEntry
    ? { kind: (feedbackEntry.verdict === "correct" ? "correct" : "wrong") as "correct" | "wrong" }
    : undefined;

  return (
    <main className="canvas">
      <Link className="inspection-back" href={`/i/${inspection.id}`}>Back to inspection</Link>
      <InspectionHero inspection={inspection} summary={summary} />
      <div style={{ marginTop: 24 }}>
        <div
          className="sheet"
          data-open="true"
          style={{ position: "static", transform: "none", maxWidth: "100%", width: "100%", boxShadow: "none" }}
        >
          <div className="sheet-header">
            <div className="sheet-nav">
              <Link
                className="btn btn-quiet"
                href={`/i/${inspection.id}/t/${Math.max(0, idx - 1)}`}
                style={idx === 0 ? { pointerEvents: "none", opacity: 0.4 } : undefined}
              >
                ← Prev
              </Link>
              <span className="position">{idx + 1} / {review.targets.length}</span>
              <Link
                className="btn btn-quiet"
                href={`/i/${inspection.id}/t/${Math.min(review.targets.length - 1, idx + 1)}`}
                style={idx >= review.targets.length - 1 ? { pointerEvents: "none", opacity: 0.4 } : undefined}
              >
                Next →
              </Link>
            </div>
            <Link className="btn btn-quiet" href={`/i/${inspection.id}`}>Close</Link>
          </div>
          <DetailContent inspection={inspection} target={target} index={idx} feedback={feedback} />
        </div>
      </div>
    </main>
  );
}
