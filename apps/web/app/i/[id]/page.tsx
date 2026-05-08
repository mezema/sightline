import Link from "next/link";
import { notFound } from "next/navigation";
import { getInspectionRepository } from "../../../server/repository";
import { buildReview, summarizeInspection } from "../../../server/review";
import { InspectionHero } from "../../_components/inspection-hero";
import { FilterTabs, type Bucket } from "../../_components/filter-tabs";
import { Tile } from "../../_components/tile";
import { LivePoller } from "../../_components/live-poller";

export const dynamic = "force-dynamic";

const BUCKETS: ReadonlyArray<Bucket> = ["all", "defect", "clean", "failed"];

function isBucket(value: string | undefined | null): value is Bucket {
  return Boolean(value) && BUCKETS.includes(value as Bucket);
}

export default async function InspectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ b?: string }>;
}) {
  const { id } = await params;
  const { b } = await searchParams;
  const inspection = await getInspectionRepository().getInspection(id);
  if (!inspection) notFound();

  const review = buildReview(inspection);
  const summary = summarizeInspection(inspection);
  const isProcessing = inspection.status === "processing" || inspection.status === "queued";

  const counts = {
    all: review.targets.length,
    defect: review.targets.filter((t) => t.bucket === "defect").length,
    clean: review.targets.filter((t) => t.bucket === "clean").length,
    failed: review.targets.filter((t) => t.bucket === "failed").length,
  };

  const activeBucket: Bucket = isBucket(b) ? b : "all";
  const visibleTargets = activeBucket === "all"
    ? review.targets
    : review.targets.filter((t) => t.bucket === activeBucket);

  const feedbackByTarget = new Map<string, { kind: "correct" | "wrong" }>();
  for (const fb of inspection.feedback) {
    if (fb.subjectType === "target" && fb.inspectionTargetId) {
      feedbackByTarget.set(fb.inspectionTargetId, { kind: fb.verdict === "correct" ? "correct" : "wrong" });
    }
  }

  return (
    <main className="canvas">
      <Link className="inspection-back" href="/">Inspections</Link>
      <InspectionHero inspection={inspection} summary={summary} />

      {!isProcessing ? (
        <FilterTabs active={activeBucket} counts={counts} baseHref={`/i/${inspection.id}`} />
      ) : null}

      <h2 className="section-title" id="targets-heading">
        {isProcessing ? `Inspecting · ${summary.processed}/${summary.total}` : "Targets"}
      </h2>

      {visibleTargets.length === 0 ? (
        <div className="empty-state">
          <strong>No targets in this filter</strong>
          <span>Try another bucket or remove the filter.</span>
        </div>
      ) : (
        <div className="tile-grid" role="list" aria-labelledby="targets-heading">
          {visibleTargets.map((target) => {
            const positionInAll = review.targets.findIndex((t) => t.id === target.id);
            return (
              <Tile
                key={target.id}
                target={target}
                href={`/i/${inspection.id}/t/${positionInAll}`}
                feedback={feedbackByTarget.get(target.id)}
              />
            );
          })}
        </div>
      )}

      {isProcessing ? <LivePoller intervalMs={1500} /> : null}
    </main>
  );
}
