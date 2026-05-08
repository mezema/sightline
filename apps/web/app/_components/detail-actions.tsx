"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function DetailActions({
  inspectionId,
  targetId,
  isFailed,
  currentFeedback,
}: {
  inspectionId: string;
  targetId: string;
  isFailed: boolean;
  currentFeedback?: "correct" | "wrong";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function sendFeedback(verdict: "correct" | "wrong") {
    startTransition(async () => {
      setError(null);
      const response = await fetch(`/api/inspections/${inspectionId}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetId, verdict }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "Could not save feedback.");
        return;
      }
      router.refresh();
    });
  }

  function retry() {
    startTransition(async () => {
      setError(null);
      const response = await fetch(`/api/inspections/${inspectionId}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "Could not retry target.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      {error ? <span className="field-value" style={{ color: "var(--alert)" }}>{error}</span> : null}
      <div className="actions">
        {!isFailed ? (
          <>
            <button
              type="button"
              className="btn btn-outline"
              disabled={pending}
              data-active={currentFeedback === "correct"}
              onClick={() => sendFeedback("correct")}
            >
              {currentFeedback === "correct" ? "✓ Marked correct" : "✓ Correct"}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              disabled={pending}
              data-active={currentFeedback === "wrong"}
              onClick={() => sendFeedback("wrong")}
            >
              {currentFeedback === "wrong" ? "✕ Marked wrong" : "✕ Wrong"}
            </button>
          </>
        ) : null}
        <button type="button" className="btn btn-outline" disabled={pending} onClick={retry}>
          {pending ? "Working…" : "Retry"}
        </button>
      </div>
    </>
  );
}
