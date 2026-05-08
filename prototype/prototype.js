const form = document.querySelector("#job-form");
const title = document.querySelector("#status-title");
const progressBar = document.querySelector("#progress-bar");
const progressText = document.querySelector("#progress-text");
const grid = document.querySelector("#results-grid");
const referenceStrip = document.querySelector("#reference-strip");
const template = document.querySelector("#result-template");

let pollTimer;

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
  renderJob(payload.job, payload.summary);
  startPolling(payload.jobId);
});

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

    renderJob(payload.job, payload.summary);
    if (payload.job.status !== "processing") clearInterval(pollTimer);
  }, 1500);
}

function renderJob(job, summary) {
  title.textContent = job.status.replace("_", " ");
  const total = Math.max(1, summary.total);
  const percent = Math.round((summary.processed / total) * 100);
  progressBar.style.width = `${percent}%`;
  progressText.textContent = `${summary.processed} / ${summary.total} processed | ${summary.detectedImages} detected | ${summary.failures} failed`;

  referenceStrip.innerHTML = `
    <img src="${job.referenceImage.url}" alt="Reference image" />
    <div>
      <strong>${escapeHtml(job.referenceImage.originalFilename)}</strong>
      <span>${escapeHtml(job.description)}</span>
    </div>
  `;

  grid.replaceChildren(...job.targetImages.map((target) => renderTarget(job, target)));
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
  title.textContent = status;
  progressText.textContent = text;
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
