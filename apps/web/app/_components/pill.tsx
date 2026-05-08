export function Pill({ state, children }: { state: string; children?: React.ReactNode }) {
  return (
    <span className="pill" data-state={state}>
      {children ?? humanize(state)}
    </span>
  );
}

function humanize(state: string) {
  switch (state) {
    case "processing": return "running";
    case "completed": return "complete";
    case "partially_failed": return "partially failed";
    case "queued": return "queued";
    case "draft": return "draft";
    case "failed": return "failed";
    case "cancelled": return "cancelled";

    default: return state.replace(/_/g, " ");
  }
}
