const form = document.querySelector("#job-form");
const pageTitle = document.querySelector("#page-title");
const serverNotice = document.querySelector("#server-notice");
const backButton = document.querySelector("#back-button");
const newInspectionButton = document.querySelector("#new-inspection-button");
const libraryPanel = document.querySelector("#library-panel");
const newInspectionPanel = document.querySelector("#new-inspection-panel");
const statusPanel = document.querySelector("#status-panel");
const resultsPanel = document.querySelector("#results-panel");
const libraryList = document.querySelector("#library-list");
const title = document.querySelector("#status-title");
const jobModeLabel = document.querySelector("#job-mode-label");
const resultsModeLabel = document.querySelector("#results-mode-label");
const progressBar = document.querySelector("#progress-bar");
const progressText = document.querySelector("#progress-text");
const grid = document.querySelector("#results-grid");
const bucketTabs = document.querySelector("#bucket-tabs");
const referenceStrip = document.querySelector("#reference-strip");
const template = document.querySelector("#result-template");
const libraryTemplate = document.querySelector("#library-row-template");

let pollTimer;
let activeBucket = "all";

if (location.protocol === "file:") {
  serverNotice.classList.remove("hidden");
  window.setTimeout(() => {
    location.href = "http://localhost:4173/prototype/";
  }, 1200);
}

backButton.addEventListener("click", () => {
  history.pushState(null, "", "#/");
  renderRoute();
});

newInspectionButton.addEventListener("click", () => {
  history.pushState(null, "", "#/new");
  renderRoute();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const targets = form.querySelector('input[name="targets"]').files;

  if (targets.length > 25) {
    setStatus("Too many targets", "Choose 25 target images or fewer.");
    return;
  }

  setStatus("Creating job", "Uploading local files into a durable job folder...");
  grid.replaceChildren();

  const response = await fetch("/api/jobs", { method: "POST", body: formData });
  const payload = await response.json();
  if (!response.ok) {
    setStatus("Could not create job", payload.error ?? "Unknown error.");
    return;
  }

  form.reset();
  history.pushState(null, "", `#/jobs/${payload.jobId}`);
  renderJob(payload.job, payload.summary);
  startPolling(payload.jobId);
});

window.addEventListener("popstate", renderRoute);
renderRoute();

async function renderRoute() {
  const route = location.hash || "#/";
  clearInterval(pollTimer);

  if (route.startsWith("#/jobs/")) {
    const parts = route.split("/");
    const jobId = parts[2];
    const requestedMode = parts[3];
    await loadJob(jobId, requestedMode);
    return;
  }

  if (route === "#/new") {
    showNewInspection();
    return;
  }

  await renderLibrary();
}

async function renderLibrary() {
  showLibrary();
  const response = await fetch("/api/jobs");
  const payload = await response.json();
  if (!response.ok) {
    libraryList.innerHTML = `<p class="empty-state">Could not load inspections: ${escapeHtml(payload.error ?? "Unknown error")}</p>`;
    return;
  }

  const jobs = payload.jobs ?? [];
  if (jobs.length === 0) {
    libraryList.innerHTML = `
      <div class="empty-state">
        <strong>No inspections yet</strong>
        <span>Start your first inspection to create a durable job.</span>
      </div>
    `;
    return;
  }

  libraryList.replaceChildren(...jobs.map(renderLibraryRow));
}

function renderLibraryRow(job) {
  const row = libraryTemplate.content.firstElementChild.cloneNode(true);
  const image = row.querySelector("img");
  const title = row.querySelector("strong");
  const summary = row.querySelector(".library-main small");
  const badge = row.querySelector(".badge");
  const time = row.querySelector(".library-meta small");

  image.src = job.referenceImage?.url ?? "";
  image.alt = job.referenceImage?.originalFilename ?? "Reference image";
  title.textContent = job.description;
  summary.textContent = `${job.summary.processed}/${job.summary.total} inspected · ${job.summary.detectedImages} with defect · ${job.summary.failures} failed`;
  badge.textContent = job.status.replace("_", " ");
  badge.className = `badge ${statusClass(job.status)}`;
  time.textContent = formatDate(job.createdAt);
  row.addEventListener("click", () => {
    openJob(job.id, job.status);
  });

  return row;
}

async function loadJob(jobId, requestedMode) {
  showJobShell("loading");
  setStatus("Loading inspection", "Reading durable job state...");
  const response = await fetch(`/api/jobs/${jobId}`);
  const payload = await response.json();
  if (!response.ok) {
    setStatus("Could not load inspection", payload.error ?? "Unknown error.");
    return;
  }

  const mode = requestedMode === "running" || requestedMode === "review"
    ? requestedMode
    : modeForJob(payload.job);
  syncJobRoute(payload.job.id, mode);
  renderJob(payload.job, payload.summary, mode);
  if (payload.job.status === "processing") startPolling(jobId);
}

function startPolling(jobId) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const response = await fetch(`/api/jobs/${jobId}`);
    const payload = await response.json();
    if (!response.ok) {
      setStatus("Could not load job", payload.error ?? "Unknown error.");
      clearInterval(pollTimer);
      return;
    }

    const mode = modeForJob(payload.job);
    syncJobRoute(payload.job.id, mode);
    renderJob(payload.job, payload.summary, mode);
    if (payload.job.status !== "processing") clearInterval(pollTimer);
  }, 1500);
}

function renderJob(job, summary, mode = modeForJob(job)) {
  showJobShell(mode);
  title.textContent = job.status.replace("_", " ");
  const total = Math.max(1, summary.total);
  const percent = Math.round((summary.processed / total) * 100);
  progressBar.style.width = `${percent}%`;
  const buckets = getBuckets(job);
  progressText.textContent = `${summary.processed} / ${summary.total} processed | ${buckets.defect.length} with defect | ${buckets.failed.length} failed`;

  referenceStrip.innerHTML = `
    <img src="${job.referenceImage.url}" alt="Reference image" />
    <div>
      <strong>${escapeHtml(job.referenceImage.originalFilename)}</strong>
      <span>${escapeHtml(job.description)}</span>
    </div>
  `;

  renderBuckets(job, buckets, mode);
  const visibleTargets = buckets[activeBucket] ?? buckets.all;
  grid.replaceChildren(...visibleTargets.map((target) => renderTarget(job, target)));
}

function renderTarget(job, target) {
  const result = job.results.find((item) => item.targetImage === fileName(target.path));
  const card = template.content.firstElementChild.cloneNode(true);
  const image = card.querySelector("img");
  const overlay = card.querySelector(".overlay");
  const heading = card.querySelector("h3");
  const detail = card.querySelector("p");
  const badge = card.querySelector(".badge");

  image.src = target.url;
  image.alt = target.originalFilename;
  heading.textContent = target.originalFilename;

  if (!result) {
    badge.textContent = "Queued";
    badge.className = "badge queued";
    detail.textContent = "Waiting for Gemini";
    drawBoxes(overlay, []);
    return card;
  }

  if (result.error) {
    badge.textContent = "Failed";
    badge.className = "badge error";
    detail.textContent = result.error;
  } else if (result.defectFound) {
    badge.textContent = "Detected";
    badge.className = "badge detected";
    detail.textContent = `${result.detections.length} detection(s), ${result.latencyMs}ms`;
  } else {
    badge.textContent = "Clear";
    badge.className = "badge clear";
    detail.textContent = `No match, ${result.latencyMs}ms`;
  }

  drawBoxes(overlay, result.detections ?? []);
  return card;
}

function renderBuckets(job, buckets, mode) {
  bucketTabs.replaceChildren();
  if (mode === "running") return;

  const bucketConfig = [
    ["all", "All", buckets.all.length],
    ["defect", "Defect", buckets.defect.length],
    ["clean", "Clean", buckets.clean.length],
    ["failed", "Failed", buckets.failed.length],
  ];

  if (!buckets[activeBucket]) activeBucket = "all";

  for (const [key, label, count] of bucketConfig) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `bucket-tab${activeBucket === key ? " active" : ""}`;
    button.textContent = `${label} ${count}`;
    button.addEventListener("click", () => {
      activeBucket = key;
      renderJob(job, summarizeFromBuckets(job, buckets), mode);
    });
    bucketTabs.append(button);
  }
}

function getBuckets(job) {
  const buckets = {
    all: [...job.targetImages],
    defect: [],
    clean: [],
    failed: [],
  };

  for (const target of job.targetImages) {
    const result = resultForTarget(job, target);
    if (!result) continue;
    if (result.error) {
      buckets.failed.push(target);
    } else if (result.defectFound) {
      buckets.defect.push(target);
    } else {
      buckets.clean.push(target);
    }
  }

  return buckets;
}

function summarizeFromBuckets(job, buckets) {
  return {
    total: job.targetImages.length,
    processed: job.results.length,
    failures: buckets.failed.length,
    detectedImages: buckets.defect.length,
    detections: job.results.reduce((sum, result) => sum + (result.detections?.length ?? 0), 0),
  };
}

function resultForTarget(job, target) {
  return job.results.find((item) => item.targetImage === fileName(target.path));
}

function drawBoxes(svg, detections) {
  svg.setAttribute("viewBox", "0 0 256 256");
  svg.replaceChildren();

  detections
    .filter((detection) => detection.box)
    .forEach((detection) => {
      const { x1, y1, x2, y2 } = detection.box;
      const rect = createSvgElement("rect", {
        x: x1,
        y: y1,
        width: Math.max(1, x2 - x1),
        height: Math.max(1, y2 - y1),
      });
      svg.append(rect);
    });
}

function setStatus(status, text) {
  showJobShell("loading");
  title.textContent = status;
  progressText.textContent = text;
}

function showLibrary() {
  activeBucket = "all";
  pageTitle.textContent = "Inspections";
  backButton.classList.add("hidden");
  newInspectionButton.classList.remove("hidden");
  libraryPanel.classList.remove("hidden");
  newInspectionPanel.classList.add("hidden");
  statusPanel.classList.add("hidden");
  resultsPanel.classList.add("hidden");
}

function showNewInspection() {
  activeBucket = "all";
  pageTitle.textContent = "New inspection";
  backButton.classList.remove("hidden");
  newInspectionButton.classList.add("hidden");
  libraryPanel.classList.add("hidden");
  newInspectionPanel.classList.remove("hidden");
  statusPanel.classList.add("hidden");
  resultsPanel.classList.add("hidden");
}

function showJobShell(mode) {
  pageTitle.textContent = mode === "running" ? "Inspection running" : mode === "review" ? "Result review" : "Inspection";
  backButton.classList.remove("hidden");
  newInspectionButton.classList.remove("hidden");
  jobModeLabel.textContent = mode === "running" ? "Running inspection" : mode === "review" ? "Result review" : "Inspection";
  resultsModeLabel.textContent = mode === "running" ? "Live targets" : "Review";
  if (mode === "running") {
    bucketTabs.replaceChildren();
    activeBucket = "all";
  }
  libraryPanel.classList.add("hidden");
  newInspectionPanel.classList.add("hidden");
  statusPanel.classList.remove("hidden");
  resultsPanel.classList.remove("hidden");
}

function openJob(jobId, status) {
  const mode = status === "processing" ? "running" : "review";
  history.pushState(null, "", `#/jobs/${jobId}/${mode}`);
  loadJob(jobId, mode);
}

function modeForJob(job) {
  return job.status === "processing" ? "running" : "review";
}

function syncJobRoute(jobId, mode) {
  const expected = `#/jobs/${jobId}/${mode}`;
  if (location.hash !== expected) history.replaceState(null, "", expected);
}

function statusClass(status) {
  if (status === "completed") return "clear";
  if (status === "failed" || status === "partially_failed") return "error";
  return "queued";
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function fileName(path) {
  return path.split("/").at(-1);
}

function createSvgElement(name, attributes) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}
