import Link from "next/link";
import { Suspense } from "react";

export function Topbar() {
  const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  return (
    <header className="topbar">
      <Link className="brand" href="/">
        <span>Sightline</span>
      </Link>
      <div className="topbar-actions">
        <Link className="btn" href="/i/new">+ New inspection</Link>
        {clerkConfigured ? (
          <Suspense fallback={null}>
            <UserMenu />
          </Suspense>
        ) : null}
      </div>
    </header>
  );
}

async function UserMenu() {
  const { UserButton } = await import("@clerk/nextjs");
  return <UserButton appearance={{ elements: { avatarBox: { width: 28, height: 28 } } }} />;
}
