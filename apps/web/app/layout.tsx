import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Topbar } from "./_components/topbar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sightline",
  description: "Durable defect-inspection workflow.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const page = (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://rsms.me/" />
        <link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
      </head>
      <body suppressHydrationWarning>
        <div className="app-shell">
          <Topbar />
          {children}
        </div>
      </body>
    </html>
  );

  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return page;
  return <ClerkProvider>{page}</ClerkProvider>;
}
