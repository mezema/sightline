import { readFile } from "node:fs/promises";

export type ImageDimensions = {
  width: number;
  height: number;
};

export async function getImageDimensions(path: string): Promise<ImageDimensions> {
  const buffer = await readFile(path);

  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  if (buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))) {
    return readJpegDimensions(buffer);
  }

  if (buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a") {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }

  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return readWebpDimensions(buffer);
  }

  throw new Error(`Could not read image dimensions for ${path}. Supported formats: jpg, png, gif, webp.`);
}

export function box1000ToPixels(box: unknown[], imageWidth: number, imageHeight: number) {
  const [y0, x0, y1, x1] = box.map((value) => Number(value));

  if ([y0, x0, y1, x1].some((value) => !Number.isFinite(value))) {
    throw new Error(`Invalid normalized box: ${JSON.stringify(box)}`);
  }

  const left = Math.round((clamp(x0, 0, 1000) / 1000) * imageWidth);
  const top = Math.round((clamp(y0, 0, 1000) / 1000) * imageHeight);
  const right = Math.round((clamp(x1, 0, 1000) / 1000) * imageWidth);
  const bottom = Math.round((clamp(y1, 0, 1000) / 1000) * imageHeight);

  return {
    x1: Math.min(left, right),
    y1: Math.min(top, bottom),
    x2: Math.max(left, right),
    y2: Math.max(top, bottom),
    coordinateSystem: "pixel" as const,
  };
}

function readJpegDimensions(buffer: Buffer): ImageDimensions {
  let offset = 2;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) break;

    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

    if (isStartOfFrame) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + length;
  }

  throw new Error("Could not find JPEG dimensions.");
}

function readWebpDimensions(buffer: Buffer): ImageDimensions {
  const chunkType = buffer.subarray(12, 16).toString("ascii");

  if (chunkType === "VP8 ") {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  if (chunkType === "VP8L") {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }

  if (chunkType === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }

  throw new Error("Could not read WebP dimensions.");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
