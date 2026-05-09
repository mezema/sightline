import { getInspectionRepository } from "../server/repository";
import { EmptyHome } from "./_components/empty-home";
import { LibraryCard } from "./_components/library-card";
import { NowRunningBand } from "./_components/now-running-band";
import { LivePoller } from "./_components/live-poller";

export const dynamic = "force-dynamic";

export default async function Home() {
  const inspections = await getInspectionRepository().listInspections();
  if (inspections.length === 0) {
    return (
      <main className="canvas">
        <EmptyHome />
      </main>
    );
  }

  const running = inspections.filter((inspection) => (inspection.status === "processing" || inspection.status === "queued") && inspection.targets.length > 0);
  const others = inspections.filter((inspection) => !running.includes(inspection));

  return (
    <main className="canvas">
      <NowRunningBand inspections={running} />
      <section aria-labelledby="library-heading">
        <h1 className="page-title" id="library-heading" style={{ marginBottom: 24 }}>Inspections</h1>
        <div className="library-grid">
          {[...running, ...others].map((inspection) => (
            <LibraryCard key={inspection.id} inspection={inspection} />
          ))}
        </div>
      </section>
      {running.length > 0 ? <LivePoller intervalMs={5000} /> : null}
    </main>
  );
}
