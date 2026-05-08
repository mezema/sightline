"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function LivePoller({ intervalMs }: { intervalMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => router.refresh(), intervalMs);
    return () => window.clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
