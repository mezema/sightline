"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";

export function Topbar() {
  const pathname = usePathname();
  if (pathname?.startsWith("/sign-in") || pathname?.startsWith("/sign-up")) {
    return null;
  }

  const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  return (
    <header className="topbar">
      <Link className="brand" href="/">
        <span>Sightline</span>
      </Link>
      <div className="topbar-actions">
        <Link className="btn" href="/i/new">+ New inspection</Link>
        {clerkConfigured ? (
          <UserButton appearance={{ elements: { avatarBox: { width: 28, height: 28 } } }} />
        ) : null}
      </div>
    </header>
  );
}
