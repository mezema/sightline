/* Sightline prototype — single-canvas state machine.
 *
 * One inspection lives at one URL and matures through three states:
 *   empty  → user fills the dossier (reference, description, targets)
 *   running → analyzer fills tiles in stable positions
 *   reviewed → filters + detail sheet for correction
 *
 * The library is the only other route. Detail is an overlay over inspection,
 * not a separate page — the reference stays visible above it.
 */

const $ = (sel) => document.querySelector(sel);

// Shell
const serverNotice = $("#server-notice");
const homeLink = $("#home-link");
const newInspectionButton = $("#new-inspection-button");
const libraryView = $("#library");
const inspectionView = $("#inspection");
const inspectionBack = $("#inspection-back");

// Library
const libraryList = $("#library-list");
const libraryRowTemplate = $("#library-row-template");

// Hero (compose + display unified)
const heroReference = $("#hero-reference");
const referenceInput = $("#reference-input");
const referenceImage = $("#reference-image");
const heroDescription = $("#hero-description");
const heroPill = $("#hero-pill");
const heroSummary = $("#hero-summary");

// Compose (empty-state-only)
const compose = $("#compose");
const composeTargets = $("#compose-targets");
const composeTargetsEmpty = $("#compose-targets-empty");
const targetsInput = $("#targets-input");
const composeHelper = $("#compose-helper");
const startInspectionButton = $("#start-inspection");

// Grid
const filters = $("#filters");
const gridLabel = $("#grid-label");
const grid = $("#grid");
const tileTemplate = $("#tile-template");

// Detail sheet
const sheet = $("#sheet");
const sheetBackdrop = $("#sheet-backdrop");
const sheetPrev = $("#sheet-prev");
const sheetNext = $("#sheet-next");
const sheetClose = $("#sheet-close");
const sheetPosition = $("#sheet-position");
const sheetImage = $("#sheet-image");
const sheetOverlay = $("#sheet-overlay");
const sheetStatus = $("#sheet-status");
const sheetFilename = $("#sheet-filename");
const sheetLatency = $("#sheet-latency");
const sheetDetectionsField = $("#sheet-detections-field");
const sheetDetections = $("#sheet-detections");
const sheetErrorField = $("#sheet-error-field");
const sheetError = $("#sheet-error");
const sheetMarkCorrect = $("#sheet-mark-correct");
const sheetMarkWrong = $("#sheet-mark-wrong");
const sheetRetry = $("#sheet-retry");

// State
let pollTimer;
let activeBucket = "all";
let currentJob = null;
let currentTargetIndex = 0;
let composeReferenceFile = null;
let composeTargetFiles = [];

// Boot
if (location.protocol === "file:") {
  serverNotice.classList.remove("hidden");
  setTimeout(() => location.replace("http://localhost:4173/prototype/"), 1200);
}

window.addEventListener("popstate", renderRoute);
window.addEventListener("keydown", onKeydown);

homeLink.addEventListener("click", () => navigate("#/"));
newInspectionButton.addEventListener("click", () => navigate("#/new"));
inspectionBack.addEventListener("click", () => navigate("#/"));

referenceInput.addEventListener("change", onReferenceChosen);
heroDescription.addEventListener("input", refreshComposeReadiness);
targetsInput.addEventListener("change", onTargetsChosen);
startInspectionButton.addEventListener("click", submitInspection);

sheetClose.addEventListener("click", closeSheet);
sheetBackdrop.addEventListener("click", closeSheet);
sheetPrev.addEventListener("click", () => stepDetail(-1));
sheetNext.addEventListener("click", () => stepDetail(1));
sheetMarkCorrect.addEventListener("click", () => sendFeedback("confirm"));
sheetMarkWrong.addEventListener("click", () => sendFeedback("reject"));
sheetRetry.addEventListener("click", retryCurrentTarget);

// Drag and drop on the targets dropzone
["dragenter", "dragover"].forEach((ev) => {
  composeTargets.addEventListener(ev, (e) => {
    e.preventDefault();
    composeTargets.dataset.active = "true";
  });
});
["dragleave", "drop"].forEach((ev) => {
  composeTargets.addEventListener(ev, (e) => {
    e.preventDefault();
    composeTargets.dataset.active = "false";
  });
});
composeTargets.addEventListener("drop", (e) => {
  if (!e.dataTransfer?.files?.length) return;
  setTargetsFromFileList(e.dataTransfer.files);
});

renderRoute();

/* ------------------------------------------------------------------ *\
 *  Routing
\* ------------------------------------------------------------------ */

function navigate(hash) {
  history.pushState(null, "", hash);
  renderRoute();
}

function renderRoute() {
  clearInterval(pollTimer);
  closeSheet({ silent: true });

  const route = location.hash || "#/";

  if (route === "#/new") {
    showInspectionView();
    enterComposeMode();
    return;
  }

  const jobMatch = route.match(/^#\/jobs\/([^/]+)(?:\/detail\/(\d+))?$/);
  if (jobMatch) {
    showInspectionView();
    loadJob(jobMatch[1]).then(() => {
      if (jobMatch[2] !== undefined) openDetail(Number(jobMatch[2]));
    });
    return;
  }

  showLibraryView();
  renderLibrary();
}

function showLibraryView() {
  libraryView.classList.remove("hidden");
  inspectionView.classList.add("hidden");
  newInspectionButton.classList.remove("hidden");
}

function showInspectionView() {
  libraryView.classList.add("hidden");
  inspectionView.classList.remove("hidden");
}

/* ------------------------------------------------------------------ *\
 *  Library
\* ------------------------------------------------------------------ */

async function renderLibrary() {
  const response = await fetch("/api/jobs");
  const payload = await response.json();
  if (!response.ok) {
    libraryList.innerHTML = `<div class="empty-state"><strong>Could not load inspections</strong><span>${escapeHtml(payload.error ?? "Unknown error")}</span></div>`;
    return;
  }
  const jobs = payload.jobs ?? [];
  if (jobs.length === 0) {
    libraryList.innerHTML = `
      <div class="empty-state">
        <strong>No inspections yet</strong>
        <span>Define a defect, drop in some images, and Sightline will check them.</span>
        <button class="btn" id="empty-new" type="button">+ Start your first inspection</button>
      </div>`;
    document.getElementById("empty-new")?.addEventListener("click", () => navigate("#/new"));
    return;
  }
  libraryList.replaceChildren(...jobs.map(renderLibraryRow));
}

function renderLibraryRow(job) {
  const node = libraryRowTemplate.content.firstElementChild.cloneNode(true);
  const img = node.querySelector("img");
  const strong = node.querySelector("strong");
  const summary = node.querySelector(".summary");
  const pill = node.querySelector(".pill");
  const timestamp = node.querySelector(".timestamp");

  img.src = job.referenceImage?.url ?? "";
  img.alt = "";
  strong.textContent = job.description || "Untitled inspection";
  summary.textContent = `${job.summary.processed}/${job.summary.total} inspected · ${job.summary.detectedImages} found · ${job.summary.failures} failed`;
  pill.textContent = job.status.replace("_", " ");
  pill.dataset.state = job.status;
  timestamp.textContent = formatDate(job.createdAt);

  node.addEventListener("click", () => navigate(`#/jobs/${job.id}`));
  return node;
}

/* ------------------------------------------------------------------ *\
 *  Compose mode (empty state of the same canvas)
\* ------------------------------------------------------------------ */

function enterComposeMode() {
  currentJob = null;
  composeReferenceFile = null;
  composeTargetFiles = [];

  inspectionView.dataset.state = "empty";
  inspectionBack.textContent = "Inspections";
  newInspectionButton.classList.add("hidden");

  // Hero in compose mode: reference is empty, description editable
  heroReference.dataset.state = "empty";
  referenceImage.hidden = true;
  referenceImage.removeAttribute("src");
  referenceInput.disabled = false;
  heroDescription.value = "";
  heroDescription.disabled = false;
  heroPill.dataset.state = "draft";
  heroPill.textContent = "draft";
  heroSummary.textContent = "";

  // Compose region visible
  compose.classList.remove("hidden");
  filters.classList.add("hidden");
  gridLabel.classList.add("hidden");
  grid.replaceChildren();
  startInspectionButton.disabled = true;
  refreshComposeReadiness();
}

function onReferenceChosen(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  composeReferenceFile = file;
  const url = URL.createObjectURL(file);
  referenceImage.src = url;
  referenceImage.hidden = false;
  heroReference.dataset.state = "filled";
  refreshComposeReadiness();
}

function onTargetsChosen(event) {
  setTargetsFromFileList(event.target.files);
}

function setTargetsFromFileList(fileList) {
  const files = Array.from(fileList || []).slice(0, 25);
  composeTargetFiles = files;
  renderComposeTiles();
  refreshComposeReadiness();
}

function renderComposeTiles() {
  if (composeTargetFiles.length === 0) {
    composeTargetsEmpty.classList.remove("hidden");
    grid.replaceChildren();
    gridLabel.classList.add("hidden");
    return;
  }

  composeTargetsEmpty.classList.add("hidden");
  gridLabel.classList.remove("hidden");
  gridLabel.textContent = `${composeTargetFiles.length} of 25 selected`;

  grid.replaceChildren(
    ...composeTargetFiles.map((file) => {
      const tile = tileTemplate.content.firstElementChild.cloneNode(true);
      tile.dataset.state = "compose";
      tile.querySelector("img").src = URL.createObjectURL(file);
      tile.querySelector(".tile-name").textContent = file.name;
      tile.querySelector(".tile-status").textContent = formatBytes(file.size);
      return tile;
    })
  );
}

function refreshComposeReadiness() {
  const ready = composeReferenceFile && heroDescription.value.trim().length > 0 && composeTargetFiles.length > 0;
  startInspectionButton.disabled = !ready;
  if (!composeReferenceFile) {
    composeHelper.textContent = "Add a reference image to begin.";
  } else if (!heroDescription.value.trim()) {
    composeHelper.textContent = "Describe what counts as a defect.";
  } else if (composeTargetFiles.length === 0) {
    composeHelper.textContent = "Add up to 25 target images.";
  } else {
    composeHelper.textContent = `${composeTargetFiles.length} target${composeTargetFiles.length === 1 ? "" : "s"} ready.`;
  }
}

async function submitInspection() {
  if (startInspectionButton.disabled) return;
  startInspectionButton.disabled = true;
  startInspectionButton.textContent = "Starting…";

  const formData = new FormData();
  formData.append("description", heroDescription.value.trim());
  formData.append("reference", composeReferenceFile);
  for (const file of composeTargetFiles) formData.append("targets", file);

  const response = await fetch("/api/jobs", { method: "POST", body: formData });
  const payload = await response.json();
  startInspectionButton.textContent = "Start inspection";

  if (!response.ok) {
    composeHelper.textContent = payload.error ?? "Could not start the inspection.";
    startInspectionButton.disabled = false;
    return;
  }

  history.replaceState(null, "", `#/jobs/${payload.jobId}`);
  await loadJob(payload.jobId, payload);
  startPolling(payload.jobId);
}

/* ------------------------------------------------------------------ *\
 *  Inspection (running + reviewed)
\* ------------------------------------------------------------------ */

async function loadJob(jobId, prefetched) {
  let payload = prefetched;
  if (!payload) {
    const response = await fetch(`/api/jobs/${jobId}`);
    payload = await response.json();
    if (!response.ok) {
      grid.innerHTML = `<div class="empty-state"><strong>Inspection not found</strong><span>${escapeHtml(payload.error ?? "")}</span></div>`;
      return;
    }
  }
  renderJob(payload.job);
  if (payload.job.status === "processing") startPolling(payload.job.id);
}

function startPolling(jobId) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const response = await fetch(`/api/jobs/${jobId}`);
    const payload = await response.json();
    if (!response.ok) {
      clearInterval(pollTimer);
      return;
    }
    renderJob(payload.job);
    if (payload.job.status !== "processing") clearInterval(pollTimer);
  }, 1500);
}

function renderJob(job) {
  currentJob = job;
  const isReview = job.status !== "processing" && job.status !== "queued";

  inspectionView.dataset.state = isReview ? "reviewed" : "running";
  inspectionBack.textContent = "Inspections";
  newInspectionButton.classList.remove("hidden");

  // Hero displays the spec (read-only now)
  heroReference.dataset.state = "filled";
  referenceImage.src = job.referenceImage.url;
  referenceImage.hidden = false;
  referenceInput.disabled = true;
  heroDescription.value = job.description;
  heroDescription.disabled = true;

  heroPill.dataset.state = job.status;
  heroPill.textContent = humanizeStatus(job.status);

  const buckets = bucketize(job);
  const summaryParts = [
    `${buckets.processed} of ${job.targetImages.length} inspected`,
    `${buckets.defect.length} found`,
  ];
  if (buckets.failed.length > 0) summaryParts.push(`${buckets.failed.length} failed`);
  heroSummary.innerHTML = summaryParts
    .map((part) => `<strong>${escapeHtml(part)}</strong>`)
    .join("");

  // Compose region hidden once a job exists
  compose.classList.add("hidden");

  // Filters only in review mode
  if (isReview) renderFilters(buckets);
  else filters.classList.add("hidden");

  // Section label
  gridLabel.classList.remove("hidden");
  gridLabel.textContent = isReview ? "Targets" : `Inspecting · ${buckets.processed}/${job.targetImages.length}`;

  // Grid: stable positions for every target
  const visible = isReview && activeBucket !== "all" ? buckets[activeBucket] : job.targetImages;
  grid.replaceChildren(...visible.map((target) => renderTile(job, target)));
}

function renderFilters(buckets) {
  filters.classList.remove("hidden");
  const config = [
    ["all", "All", buckets.all.length],
    ["defect", "Defect", buckets.defect.length],
    ["clean", "Clean", buckets.clean.length],
    ["failed", "Failed", buckets.failed.length],
  ];
  filters.replaceChildren(
    ...config.map(([key, label, count]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "filter";
      button.role = "tab";
      button.setAttribute("aria-pressed", String(activeBucket === key));
      button.innerHTML = `${label} <span class="count">${count}</span>`;
      button.addEventListener("click", () => {
        activeBucket = key;
        renderJob(currentJob);
      });
      return button;
    })
  );
}

function renderTile(job, target) {
  const tile = tileTemplate.content.firstElementChild.cloneNode(true);
  const img = tile.querySelector("img");
  const overlay = tile.querySelector(".overlay");
  const name = tile.querySelector(".tile-name");
  const status = tile.querySelector(".tile-status");

  img.src = target.url;
  img.alt = "";
  name.textContent = target.originalFilename;

  const result = resultForTarget(job, target);
  const feedback = latestFeedbackForTarget(job, target);
  const { state, statusText } = tileState(job, target, result, feedback);

  tile.dataset.state = state;
  status.textContent = statusText;

  if (feedback) {
    const mark = document.createElement("span");
    mark.className = "tile-mark";
    mark.dataset.mark = feedback.kind;
    mark.textContent = feedback.kind === "confirm" ? "Correct" : "Wrong";
    status.appendChild(mark);
  }

  drawBoxes(overlay, result?.detections ?? []);

  tile.addEventListener("click", () => {
    const index = job.targetImages.findIndex((t) => t.id === target.id);
    openDetail(index);
  });
  return tile;
}

function tileState(job, target, result, feedback) {
  if (!result) {
    if (job.status === "processing") return { state: "running", statusText: "Inspecting…" };
    return { state: "queued", statusText: "Queued" };
  }
  if (result.error) {
    return { state: "failed", statusText: "Could not inspect" };
  }
  const isDefect = result.defectFound && feedback?.kind !== "reject";
  if (isDefect) {
    const count = result.detections?.length ?? 0;
    return { state: "defect", statusText: `${count} detection${count === 1 ? "" : "s"}` };
  }
  return { state: "clean", statusText: "Clean" };
}

/* ------------------------------------------------------------------ *\
 *  Detail sheet
\* ------------------------------------------------------------------ */

function openDetail(index) {
  if (!currentJob) return;
  currentTargetIndex = clamp(index, 0, currentJob.targetImages.length - 1);
  renderDetail();
  sheet.dataset.open = "true";
  sheetBackdrop.dataset.open = "true";
  history.replaceState(null, "", `#/jobs/${currentJob.id}/detail/${currentTargetIndex}`);
}

function closeSheet({ silent = false } = {}) {
  sheet.dataset.open = "false";
  sheetBackdrop.dataset.open = "false";
  if (!silent && currentJob) history.replaceState(null, "", `#/jobs/${currentJob.id}`);
}

function stepDetail(delta) {
  if (!currentJob) return;
  currentTargetIndex = clamp(currentTargetIndex + delta, 0, currentJob.targetImages.length - 1);
  renderDetail();
  history.replaceState(null, "", `#/jobs/${currentJob.id}/detail/${currentTargetIndex}`);
}

function renderDetail() {
  const target = currentJob.targetImages[currentTargetIndex];
  const result = resultForTarget(currentJob, target);
  const feedback = latestFeedbackForTarget(currentJob, target);

  sheetImage.src = target.url;
  sheetImage.alt = target.originalFilename;
  sheetFilename.textContent = target.originalFilename;
  sheetPosition.textContent = `${currentTargetIndex + 1} / ${currentJob.targetImages.length}`;
  sheetPrev.disabled = currentTargetIndex === 0;
  sheetNext.disabled = currentTargetIndex === currentJob.targetImages.length - 1;

  const { state } = tileState(currentJob, target, result, feedback);

  sheetStatus.textContent =
    state === "defect" ? "Defect found"
    : state === "clean" ? "Clean"
    : state === "failed" ? "Failed"
    : state === "running" ? "Inspecting"
    : "Queued";

  sheetLatency.textContent = result ? `${result.latencyMs}ms` : "—";

  if (result?.error) {
    sheetErrorField.hidden = false;
    sheetError.textContent = result.error;
    sheetDetectionsField.hidden = true;
    sheetRetry.classList.remove("hidden");
  } else {
    sheetErrorField.hidden = true;
    sheetRetry.classList.add("hidden");
  }

  if (result && !result.error && result.detections?.length) {
    sheetDetectionsField.hidden = false;
    sheetDetections.replaceChildren(
      ...result.detections.map((d, i) => {
        const li = document.createElement("li");
        li.innerHTML = `<strong>${escapeHtml(d.label || `Detection ${i + 1}`)}</strong><span>${escapeHtml(d.reason ?? "")}</span>`;
        return li;
      })
    );
  } else {
    sheetDetectionsField.hidden = true;
  }

  sheetMarkCorrect.dataset.active = feedback?.kind === "confirm" ? "true" : "false";
  sheetMarkWrong.dataset.active = feedback?.kind === "reject" ? "true" : "false";

  sheetMarkCorrect.textContent = feedback?.kind === "confirm" ? "✓ Marked correct" : "✓ Correct";
  sheetMarkWrong.textContent = feedback?.kind === "reject" ? "✕ Marked wrong" : "✕ Wrong";

  drawBoxes(sheetOverlay, result?.detections ?? [], { withLabels: true });
}

async function sendFeedback(kind) {
  if (!currentJob) return;
  const target = currentJob.targetImages[currentTargetIndex];
  const response = await fetch(`/api/jobs/${currentJob.id}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ targetImageId: target.id, kind }),
  });
  const payload = await response.json();
  if (!response.ok) return alert(payload.error ?? "Could not save feedback.");
  renderJob(payload.job);
  renderDetail();
}

async function retryCurrentTarget() {
  if (!currentJob) return;
  const target = currentJob.targetImages[currentTargetIndex];
  const response = await fetch(`/api/jobs/${currentJob.id}/retry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ targetImageId: target.id }),
  });
  const payload = await response.json();
  if (!response.ok) return alert(payload.error ?? "Could not retry target.");
  renderJob(payload.job);
  renderDetail();
  startPolling(currentJob.id);
}

function onKeydown(event) {
  if (sheet.dataset.open !== "true") return;
  if (event.key === "Escape") closeSheet();
  if (event.key === "ArrowLeft") stepDetail(-1);
  if (event.key === "ArrowRight") stepDetail(1);
}

/* ------------------------------------------------------------------ *\
 *  Helpers
\* ------------------------------------------------------------------ */

function bucketize(job) {
  const buckets = { all: [...job.targetImages], defect: [], clean: [], failed: [], processed: 0 };
  for (const target of job.targetImages) {
    const result = resultForTarget(job, target);
    if (!result) continue;
    buckets.processed += 1;
    const feedback = latestFeedbackForTarget(job, target);
    if (result.error) buckets.failed.push(target);
    else if (result.defectFound && feedback?.kind !== "reject") buckets.defect.push(target);
    else buckets.clean.push(target);
  }
  return buckets;
}

function resultForTarget(job, target) {
  return job.results.find((item) => item.targetImage === fileName(target.path));
}

function latestFeedbackForTarget(job, target) {
  return [...(job.feedback ?? [])].reverse().find((f) => f.targetImageId === target.id);
}

function drawBoxes(svg, detections, { withLabels = false } = {}) {
  svg.setAttribute("viewBox", "0 0 256 256");
  svg.replaceChildren();
  detections
    .filter((d) => d.box)
    .forEach((d, i) => {
      const { x1, y1, x2, y2 } = d.box;
      const rect = svgEl("rect", {
        x: x1, y: y1,
        width: Math.max(1, x2 - x1),
        height: Math.max(1, y2 - y1),
      });
      svg.append(rect);
      if (withLabels && d.label) {
        const text = svgEl("text", { x: x1 + 4, y: y1 + 14 });
        text.textContent = d.label;
        svg.append(text);
      }
    });
}

function svgEl(name, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function humanizeStatus(status) {
  return ({
    draft: "draft",
    queued: "queued",
    processing: "running",
    completed: "complete",
    failed: "failed",
    partially_failed: "partially failed",
  })[status] ?? status.replace("_", " ");
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const u = ["B", "KB", "MB"];
  let i = 0; let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

function fileName(path) {
  return path.split("/").at(-1);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
}
