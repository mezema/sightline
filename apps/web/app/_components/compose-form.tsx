"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getExample, type ExampleInspection } from "./examples";

type UploadDescriptor = {
  imageAssetId: string;
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
};

const MAX_TARGETS = 25;
const fileKey = (file: File) => `${file.name}|${file.size}|${file.lastModified}`;

export function ComposeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const exampleId = searchParams?.get("example") ?? null;
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState<File | null>(null);
  const [referencePreview, setReferencePreview] = useState<string | null>(null);
  const [targets, setTargets] = useState<File[]>([]);
  const [targetPreviews, setTargetPreviews] = useState<string[]>([]);
  const [helper, setHelper] = useState("Add a reference image to begin.");
  const [progress, setProgress] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [loadingExample, setLoadingExample] = useState(false);
  const targetsInputRef = useRef<HTMLInputElement>(null);

  const busy = submitting || loadingExample;
  const ready = Boolean(reference) && description.trim().length > 0 && targets.length > 0;
  const remaining = MAX_TARGETS - targets.length;

  useEffect(() => {
    if (loadingExample) return setHelper("Loading example…");
    if (!reference) return setHelper("Add a reference image to begin.");
    if (description.trim().length === 0) return setHelper("Describe what counts as a defect.");
    if (targets.length === 0) return setHelper("Add up to 25 target images.");
    setHelper(`${targets.length} target${targets.length === 1 ? "" : "s"} ready.`);
  }, [reference, description, targets.length, loadingExample]);

  useEffect(() => {
    if (!exampleId) return;
    const example = getExample(exampleId);
    if (!example) return;
    let cancelled = false;
    setLoadingExample(true);
    (async () => {
      try {
        const [referenceFile, ...targetFiles] = await loadExampleFiles(example);
        if (cancelled) return;
        setDescription(example.description);
        setReference(referenceFile);
        setReferencePreview((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return URL.createObjectURL(referenceFile);
        });
        const urls = targetFiles.map((file) => URL.createObjectURL(file));
        setTargets(targetFiles);
        setTargetPreviews((previous) => {
          previous.forEach((url) => URL.revokeObjectURL(url));
          return urls;
        });
      } catch {
        // Fall through silently — user can still author by hand.
      } finally {
        if (!cancelled) setLoadingExample(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [exampleId]);

  function chooseReference(file: File | undefined) {
    if (!file) return;
    setReference(file);
    if (referencePreview) URL.revokeObjectURL(referencePreview);
    setReferencePreview(URL.createObjectURL(file));
  }

  function addTargets(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || remaining <= 0) return;
    const seen = new Set(targets.map(fileKey));
    const incoming: File[] = [];
    for (const file of Array.from(fileList)) {
      if (incoming.length >= remaining) break;
      const key = fileKey(file);
      if (seen.has(key)) continue;
      seen.add(key);
      incoming.push(file);
    }
    if (incoming.length === 0) return;
    const incomingUrls = incoming.map((file) => URL.createObjectURL(file));
    setTargets((prev) => [...prev, ...incoming]);
    setTargetPreviews((prev) => [...prev, ...incomingUrls]);
  }

  function removeTarget(index: number) {
    setTargetPreviews((prev) => {
      const url = prev[index];
      if (url) URL.revokeObjectURL(url);
      return prev.filter((_, i) => i !== index);
    });
    setTargets((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit() {
    if (!ready || !reference) return;
    setSubmitting(true);
    setProgress("Preparing private upload URLs…");

    try {
      const session = await prepareUploads(description.trim(), reference, targets);
      const filesByIndex = [reference, ...targets];
      setProgress(`Uploading ${filesByIndex.length} private images…`);
      for (let index = 0; index < session.uploads.length; index += 1) {
        const upload = session.uploads[index];
        const file = filesByIndex[index];
        if (!upload || !file) throw new Error("Upload session did not match selected images.");
        setProgress(`Uploading private image ${index + 1} of ${filesByIndex.length}…`);
        await uploadWithRetry(upload, file);
      }

      setProgress("Verifying uploads…");
      const completeResponse = await fetch(`/api/inspections/${session.inspectionId}/complete-uploads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageAssetIds: session.uploads.map((upload) => upload.imageAssetId) }),
      });
      const payload = await completeResponse.json();
      if (!completeResponse.ok) throw new Error(payload.error ?? "Could not complete uploads.");

      router.push(`/i/${session.inspectionId}`);
      router.refresh();
    } catch (error) {
      setProgress(null);
      setHelper(error instanceof Error ? error.message : "Could not start the inspection.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <Link className="inspection-back" href="/">Inspections</Link>

      <div className="hero">
        <label className="hero-reference" data-state={referencePreview ? "filled" : "empty"}>
          <input
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => chooseReference(e.target.files?.[0])}
          />
          {referencePreview ? <img src={referencePreview} alt="Reference" /> : null}
        </label>
        <div className="hero-text">
          <label className="hero-description-label" htmlFor="defect-spec">
            Defect spec
          </label>
          <textarea
            id="defect-spec"
            className="hero-description-input"
            placeholder="Describe what counts as a defect…"
            rows={2}
            value={description}
            disabled={busy}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="hero-meta">
            <span className="pill" data-state="draft">draft</span>
          </div>
        </div>
      </div>

      <div
        className="compose-targets"
        data-state={targets.length === 0 ? "empty" : "filled"}
        data-active={dragOver ? "true" : "false"}
        onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer?.files?.length) addTargets(e.dataTransfer.files);
        }}
      >
        <input
          ref={targetsInputRef}
          type="file"
          accept="image/*"
          multiple
          disabled={busy}
          onChange={(e) => {
            addTargets(e.target.files);
            e.target.value = "";
          }}
          style={{ display: "none" }}
        />
        {targets.length === 0 ? (
          <button
            type="button"
            className="compose-targets-empty"
            disabled={busy}
            onClick={() => targetsInputRef.current?.click()}
          >
            <strong>Add target images</strong>
            <span>Drop here or click to choose. Up to 25.</span>
          </button>
        ) : (
          <div className="tile-grid">
            {targetPreviews.map((url, i) => (
              <div className="tile" key={url}>
                <div className="tile-image">
                  <img src={url} alt={targets[i]?.name ?? ""} />
                  <button
                    type="button"
                    className="tile-remove"
                    aria-label={`Remove ${targets[i]?.name ?? "target"}`}
                    disabled={busy}
                    onClick={(e) => { e.stopPropagation(); removeTarget(i); }}
                  >
                    ×
                  </button>
                </div>
                <div className="tile-meta">
                  <span className="tile-name">{targets[i]?.name}</span>
                  <span className="tile-status">{formatBytes(targets[i]?.size ?? 0)}</span>
                </div>
              </div>
            ))}
            {remaining > 0 ? (
              <button
                type="button"
                className="tile tile-add"
                disabled={busy}
                onClick={() => targetsInputRef.current?.click()}
              >
                <span className="tile-image" aria-hidden="true">+</span>
                <span className="tile-meta">
                  <span className="tile-name">Add more</span>
                  <span className="tile-status">{remaining} slot{remaining === 1 ? "" : "s"} left</span>
                </span>
              </button>
            ) : null}
          </div>
        )}
      </div>

      <div className="compose-action-bar">
        <div className="compose-action-bar-inner">
          <span className="compose-helper">{progress ?? helper}</span>
          <button className="btn" type="button" disabled={!ready || submitting} onClick={() => void submit()}>
            {submitting ? "Starting…" : "Start inspection"}
          </button>
        </div>
      </div>
    </>
  );
}

async function uploadWithRetry(upload: UploadDescriptor, file: File) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(upload.uploadUrl, {
        method: upload.method,
        headers: upload.headers,
        body: file,
      });
      if (response.ok) return;
      const errorText = await response.text();
      throw new Error(errorText || `HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
    }
  }

  const detail = lastError instanceof Error ? ` ${lastError.message}` : "";
  throw new Error(`Upload failed for ${file.name}.${detail}`);
}

async function prepareUploads(description: string, reference: File, targets: File[]) {
  const response = await fetch("/api/inspections/upload-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      description,
      reference: await fileMetadata(reference),
      targets: await Promise.all(targets.map(fileMetadata)),
    }),
  });
  const session = (await response.json()) as { inspectionId?: string; uploads?: UploadDescriptor[]; error?: string };
  if (!response.ok || !session.inspectionId || !session.uploads) {
    throw new Error(session.error ?? "Could not prepare uploads.");
  }
  return { inspectionId: session.inspectionId, uploads: session.uploads };
}

async function fileMetadata(file: File) {
  const dimensions = await imageDimensions(file).catch(() => undefined);
  return {
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    byteSize: file.size,
    width: dimensions?.width,
    height: dimensions?.height,
  };
}

function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = document.createElement("img");
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image dimensions."));
    };
    image.src = url;
  });
}

async function loadExampleFiles(example: ExampleInspection): Promise<File[]> {
  const assets = [example.reference, ...example.targets];
  return Promise.all(
    assets.map(async (asset) => {
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error(`Could not load ${asset.url}`);
      const blob = await response.blob();
      return new File([blob], asset.filename, { type: asset.mimeType });
    }),
  );
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
