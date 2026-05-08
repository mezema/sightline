import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const uploadRoot = join(process.cwd(), ".sightline-uploads");

export function assetIdFromStorageKey(storageKey: string) {
  return storageKey.split("/").filter(Boolean).at(-1) ?? storageKey;
}

export async function writeLocalUpload(assetId: string, input: { bytes: Buffer; mimeType?: string }) {
  await mkdir(uploadRoot, { recursive: true });
  await writeFile(blobPath(assetId), input.bytes);
  await writeFile(metaPath(assetId), JSON.stringify({ mimeType: input.mimeType ?? "application/octet-stream", byteSize: input.bytes.byteLength }));
}

export async function readLocalUpload(assetId: string) {
  const [bytes, meta] = await Promise.all([readFile(blobPath(assetId)), readLocalUploadMetadata(assetId)]);
  return { bytes, ...meta };
}

export async function readLocalUploadMetadata(assetId: string) {
  const fallback = await stat(blobPath(assetId));
  try {
    const meta = JSON.parse(await readFile(metaPath(assetId), "utf8")) as { mimeType?: string; byteSize?: number };
    return {
      mimeType: meta.mimeType ?? "application/octet-stream",
      byteSize: meta.byteSize ?? fallback.size,
    };
  } catch {
    return { mimeType: "application/octet-stream", byteSize: fallback.size };
  }
}

function blobPath(assetId: string) {
  return join(uploadRoot, `${assetId}.blob`);
}

function metaPath(assetId: string) {
  return join(uploadRoot, `${assetId}.json`);
}
