import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { createDb, imageAssets } from "@sightline/db";
import { getImageStorage } from "../../../../server/storage";

export async function GET(_request: Request, context: { params: Promise<{ assetId: string }> }) {
  try {
    const { assetId } = await context.params;
    const asset = await loadAsset(assetId);
    if (!asset) return NextResponse.json({ error: "Image not found." }, { status: 404 });

    const storage = getImageStorage();
    if (!storage.readObject) return NextResponse.json({ error: "Image reads are not supported by this storage adapter." }, { status: 501 });

    const object = await storage.readObject(asset.storageKey);
    return new Response(Buffer.from(object.bytes), {
      headers: {
        "cache-control": "private, max-age=60",
        "content-length": String(object.bytes.byteLength),
        "content-type": object.mimeType || asset.mimeType,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read upload." }, { status: 400 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ assetId: string }> }) {
  try {
    const { assetId } = await context.params;
    if (!process.env.DATABASE_URL && isDevUploadTarget(assetId)) {
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength === 0) return NextResponse.json({ error: "Upload is empty." }, { status: 400 });
      return new Response(null, { status: 204 });
    }

    const asset = await loadAsset(assetId);
    if (!asset) return NextResponse.json({ error: "Upload target not found." }, { status: 404 });

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength !== asset.byteSize) {
      return NextResponse.json({ error: `Upload size mismatch for ${asset.originalFilename}.` }, { status: 400 });
    }

    const requestMimeType = normalizeMimeType(request.headers.get("content-type") ?? asset.mimeType);
    if (requestMimeType !== normalizeMimeType(asset.mimeType)) {
      return NextResponse.json({ error: `Upload MIME type mismatch for ${asset.originalFilename}.` }, { status: 400 });
    }

    const storage = getImageStorage();
    if (!storage.writeObject) return NextResponse.json({ error: "Server-side uploads are not supported by this storage adapter." }, { status: 501 });

    await storage.writeObject(asset.storageKey, { bytes, mimeType: asset.mimeType });
    await createDb().update(imageAssets).set({ uploadStatus: "uploaded" }).where(eq(imageAssets.id, asset.id));

    return new Response(null, { status: 204 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not write upload." }, { status: 400 });
  }
}

async function loadAsset(assetId: string) {
  if (!process.env.DATABASE_URL) return undefined;

  const db = createDb();
  const [asset] = await db
    .select()
    .from(imageAssets)
    .where(eq(imageAssets.id, assetId));

  return asset;
}

function normalizeMimeType(mimeType: string) {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? mimeType.toLowerCase();
}

function isDevUploadTarget(assetId: string) {
  return assetId === "dev-reference" || assetId === "dev-target";
}
