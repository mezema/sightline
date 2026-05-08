"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export function DetailSheet({
  children,
  inspectionId,
  index,
  total,
}: {
  children: React.ReactNode;
  inspectionId: string;
  index: number;
  total: number;
}) {
  const router = useRouter();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") router.back();
      if (event.key === "ArrowLeft" && index > 0) router.replace(`/i/${inspectionId}/t/${index - 1}`);
      if (event.key === "ArrowRight" && index < total - 1) router.replace(`/i/${inspectionId}/t/${index + 1}`);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, inspectionId, index, total]);

  return (
    <>
      <div className="sheet-backdrop" data-open="true" onClick={() => router.back()} />
      <aside className="sheet" data-open="true" aria-modal="true" role="dialog">
        <div className="sheet-header">
          <div className="sheet-nav">
            <Link
              className="btn btn-quiet"
              href={`/i/${inspectionId}/t/${Math.max(0, index - 1)}`}
              aria-disabled={index === 0}
              replace
              style={index === 0 ? { pointerEvents: "none", opacity: 0.4 } : undefined}
            >
              ← Prev
            </Link>
            <span className="position">{index + 1} / {total}</span>
            <Link
              className="btn btn-quiet"
              href={`/i/${inspectionId}/t/${Math.min(total - 1, index + 1)}`}
              aria-disabled={index >= total - 1}
              replace
              style={index >= total - 1 ? { pointerEvents: "none", opacity: 0.4 } : undefined}
            >
              Next →
            </Link>
          </div>
          <button type="button" className="btn btn-quiet" onClick={() => router.back()}>
            Close <span className="kbd">Esc</span>
          </button>
        </div>
        {children}
      </aside>
    </>
  );
}
