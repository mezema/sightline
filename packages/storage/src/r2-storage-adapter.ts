import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStorage } from "@sightline/core";

export type R2StorageConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl?: string;
  uploadMode?: "direct" | "server";
  maxAttempts?: number;
};

export class R2ImageStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: R2StorageConfig) {
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      maxAttempts: config.maxAttempts ?? 5,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async createUploadUrl(input: { ownerUserId: string; inspectionId: string; imageAssetId: string; mimeType?: string }) {
    const storageKey = `${input.ownerUserId}/${input.inspectionId}/${input.imageAssetId}`;
    if (this.config.uploadMode === "server") {
      return {
        storageKey,
        url: `/api/uploads/${input.imageAssetId}`,
        method: "PUT" as const,
        headers: input.mimeType ? { "content-type": input.mimeType } : ({} as Record<string, string>),
      };
    }

    const command = new PutObjectCommand({ Bucket: this.config.bucket, Key: storageKey, ContentType: input.mimeType });
    return {
      storageKey,
      url: await getSignedUrl(this.client, command, { expiresIn: 60 * 5 }),
      method: "PUT" as const,
      headers: input.mimeType ? { "content-type": input.mimeType } : ({} as Record<string, string>),
    };
  }

  async createReadUrl(storageKey: string) {
    const command = new GetObjectCommand({ Bucket: this.config.bucket, Key: storageKey });
    return getSignedUrl(this.client, command, { expiresIn: 60 * 5 });
  }

  async writeObject(storageKey: string, input: { bytes: Uint8Array; mimeType?: string }) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: storageKey,
        Body: Buffer.from(input.bytes),
        ContentType: input.mimeType,
      }),
    );
  }

  async createInlineReadUrl(storageKey: string) {
    const object = await this.readObject(storageKey);
    return `data:${object.mimeType};base64,${Buffer.from(object.bytes).toString("base64")}`;
  }

  async readObject(storageKey: string) {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: storageKey }));
    if (!response.Body) throw new Error(`R2 object ${storageKey} has no body.`);
    const bytes = Buffer.from(await response.Body.transformToByteArray());
    const mimeType = response.ContentType ?? "application/octet-stream";
    return { bytes, mimeType };
  }

  async head(storageKey: string) {
    const response = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: storageKey }));
    return {
      byteSize: response.ContentLength,
      mimeType: response.ContentType,
    };
  }

  async exists(storageKey: string) {
    try {
      await this.head(storageKey);
      return true;
    } catch {
      return false;
    }
  }
}
