"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function DeleteControl({ inspectionId }: { inspectionId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function destroy() {
    startTransition(async () => {
      setError(null);
      const response = await fetch(`/api/inspections/${inspectionId}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "Could not delete inspection.");
        return;
      }
      router.push("/");
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <div className="cancel-row">
        <button type="button" className="cancel-link" onClick={() => setConfirming(true)}>
          Delete inspection
        </button>
        {error ? <span className="cancel-error">{error}</span> : null}
      </div>
    );
  }

  return (
    <div className="cancel-row" data-confirming="true">
      <span className="cancel-prompt">Delete this inspection? Cannot be undone.</span>
      <div className="cancel-buttons">
        <button type="button" className="btn btn-outline" disabled={pending} onClick={destroy}>
          {pending ? "Deleting…" : "Yes, delete"}
        </button>
        <button type="button" className="btn btn-quiet" disabled={pending} onClick={() => setConfirming(false)}>
          Keep
        </button>
      </div>
    </div>
  );
}
