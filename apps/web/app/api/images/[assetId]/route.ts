import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { createDbConnection, imageAssets } from "@sightline/db";
import { getImageStorage } from "../../../../server/storage";

export async function GET(request: Request, context: { params: Promise<{ assetId: string }> }) {
  if (!process.env.DATABASE_URL) return NextResponse.redirect(new URL("/sample-target-1.svg", request.url));

  const { assetId } = await context.params;
  const connection = createDbConnection(process.env.DATABASE_URL);
  let asset: typeof imageAssets.$inferSelect | undefined;
  try {
    [asset] = await connection.db.select().from(imageAssets).where(eq(imageAssets.id, assetId));
  } finally {
    await connection.close();
  }
  if (!asset) return NextResponse.json({ error: "Image not found." }, { status: 404 });
  if (asset.uploadStatus !== "verified") {
    return placeholderImage(asset.kind === "reference" ? "Reference pending" : "Upload pending");
  }

  if (asset.storageKey.startsWith("local/")) {
    return NextResponse.redirect(new URL(`/api/uploads/${asset.id}`, request.url));
  }

  if (asset.storageKey.startsWith("integration/")) {
    const sample = asset.kind === "reference" ? "/sample-reference.svg" : "/sample-target-1.svg";
    return NextResponse.redirect(new URL(sample, request.url));
  }

  const readUrl = await getImageStorage().createReadUrl(asset.storageKey);
  if (!readUrl.startsWith("http://") && !readUrl.startsWith("https://") && !readUrl.startsWith("/")) {
    const sample = asset.kind === "reference" ? "/sample-reference.svg" : "/sample-target-1.svg";
    return NextResponse.redirect(new URL(sample, request.url));
  }
  return NextResponse.redirect(readUrl.startsWith("/") ? new URL(readUrl, request.url) : readUrl);
}

function placeholderImage(label: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220" viewBox="0 0 320 220" role="img" aria-label="${escapeSvg(label)}"><rect width="320" height="220" fill="#f3f4f6"/><path d="M48 150 112 92l42 38 28-26 90 74H48z" fill="#d1d5db"/><circle cx="225" cy="72" r="20" fill="#c7d2fe"/><text x="160" y="194" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="16" fill="#4b5563">${escapeSvg(label)}</text></svg>`;
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "private, max-age=30",
    },
  });
}

function escapeSvg(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
