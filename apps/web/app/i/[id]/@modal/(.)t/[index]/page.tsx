import { notFound } from "next/navigation";
import type { Feedback } from "@sightline/core";
import { getInspectionRepository } from "../../../../../../server/repository";
import { buildReview } from "../../../../../../server/review";
import { DetailContent } from "../../../../../_components/detail-content";
import { DetailSheet } from "../../../../../_components/detail-sheet";

export const dynamic = "force-dynamic";

export default async function InterceptedDetail({
  params,
}: {
  params: Promise<{ id: string; index: string }>;
}) {
  const { id, index } = await params;
  const inspection = await getInspectionRepository().getInspection(id);
  if (!inspection) notFound();

  const review = buildReview(inspection);
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
    <DetailSheet inspectionId={inspection.id} index={idx} total={review.targets.length}>
      <DetailContent inspection={inspection} target={target} index={idx} feedback={feedback} />
    </DetailSheet>
  );
}
