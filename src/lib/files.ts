import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

const imageMimeTypes = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);

export async function readImageAsInlineData(path: string): Promise<{ mimeType: string; data: string }> {
  return {
    mimeType: mimeTypeForPath(path),
    data: await readFileAsBase64(path),
  };
}

export async function readFileAsBase64(path: string): Promise<string> {
  return (await readFile(path)).toString("base64");
}

export async function listImages(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && imageMimeTypes.has(extname(entry.name).toLowerCase()))
    .map((entry) => join(directory, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

export function mimeTypeForPath(path: string): string {
  const mimeType = imageMimeTypes.get(extname(path).toLowerCase());
  if (!mimeType) throw new Error(`Unsupported image type for ${path}. Use jpg, png, webp, or gif.`);
  return mimeType;
}
