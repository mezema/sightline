import { R2ImageStorage } from "@sightline/storage";
import type { ObjectStorage } from "@sightline/core";
import { assetIdFromStorageKey, readLocalUpload, readLocalUploadMetadata, writeLocalUpload } from "./local-upload-store";

let cachedStorage: ObjectStorage | undefined;

export function getImageStorage() {
  if (cachedStorage) return cachedStorage;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;

  const r2Values = [accountId, accessKeyId, secretAccessKey, bucket];
  const hasPartialR2Config = r2Values.some(Boolean) && !r2Values.every(Boolean);
  if (hasPartialR2Config) {
    throw new Error("Incomplete R2 configuration. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.");
  }

  cachedStorage =
    accountId && accessKeyId && secretAccessKey && bucket
      ? new R2ImageStorage({
          accountId,
          accessKeyId,
          secretAccessKey,
          bucket,
          uploadMode: process.env.SIGHTLINE_UPLOAD_MODE === "server" ? "server" : "direct",
        })
      : localImageStorage;

  return cachedStorage;
}

const localImageStorage: ObjectStorage = {
  async createUploadUrl(input) {
    const storageKey = `local/${input.ownerUserId}/${input.inspectionId}/${input.imageAssetId}`;
    return {
      storageKey,
      url: `/api/uploads/${input.imageAssetId}`,
      method: "PUT",
      headers: uploadHeaders(input.mimeType),
    };
  },
  async createReadUrl(storageKey) {
    if (storageKey.startsWith("/")) return storageKey;
    return `/api/uploads/${assetIdFromStorageKey(storageKey)}`;
  },
  async writeObject(storageKey, input) {
    await writeLocalUpload(assetIdFromStorageKey(storageKey), {
      bytes: Buffer.from(input.bytes),
      mimeType: input.mimeType,
    });
  },
  async readObject(storageKey) {
    return readLocalUpload(assetIdFromStorageKey(storageKey));
  },
  async exists(storageKey) {
    try {
      await readLocalUploadMetadata(assetIdFromStorageKey(storageKey));
      return true;
    } catch {
      return false;
    }
  },
  async head(storageKey) {
    const metadata = await readLocalUploadMetadata(assetIdFromStorageKey(storageKey));
    return {
      byteSize: metadata.byteSize,
      mimeType: metadata.mimeType,
    };
  },
};

function uploadHeaders(mimeType: string | undefined): Record<string, string> {
  return mimeType ? { "content-type": mimeType } : {};
}
