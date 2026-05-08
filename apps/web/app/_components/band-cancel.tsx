"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function BandCancel({ inspectionId }: { inspectionId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    startTransition(async () => {
      setError(null);
      const response = await fetch(`/api/inspections/${inspectionId}/cancel`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "Could not cancel.");
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        className="band-cancel"
        title="Cancel this inspection"
        aria-label="Cancel this inspection"
        onClick={() => setConfirming(true)}
      >
        ×
      </button>
    );
  }

  return (
    <div className="band-cancel-confirm" role="group" aria-label="Confirm cancel">
      <span className="band-cancel-prompt">Stop?</span>
      <button type="button" className="btn btn-outline btn-tiny" disabled={pending} onClick={cancel}>
        {pending ? "…" : "Yes"}
      </button>
      <button type="button" className="btn btn-quiet btn-tiny" disabled={pending} onClick={() => setConfirming(false)}>
        Keep running
      </button>
      {error ? <span className="band-cancel-error">{error}</span> : null}
    </div>
  );
}
