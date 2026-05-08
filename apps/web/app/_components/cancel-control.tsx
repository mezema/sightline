"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function CancelControl({ inspectionId }: { inspectionId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function cancel() {
    startTransition(async () => {
      setError(null);
      const response = await fetch(`/api/inspections/${inspectionId}/cancel`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "Could not cancel inspection.");
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <div className="cancel-row">
        <button type="button" className="cancel-link" onClick={() => setConfirming(true)}>
          Cancel inspection
        </button>
        {error ? <span className="cancel-error">{error}</span> : null}
      </div>
    );
  }

  return (
    <div className="cancel-row" data-confirming="true">
      <span className="cancel-prompt">Stop processing? Targets in flight won't be checked.</span>
      <div className="cancel-buttons">
        <button type="button" className="btn btn-outline" disabled={pending} onClick={cancel}>
          {pending ? "Cancelling…" : "Yes, cancel"}
        </button>
        <button type="button" className="btn btn-quiet" disabled={pending} onClick={() => setConfirming(false)}>
          Keep running
        </button>
      </div>
    </div>
  );
}
