const resultsUrl = "../outputs/results.json";
const targetBasePath = "../samples/targets/";
const grid = document.querySelector("#results-grid");
const summary = document.querySelector("#summary");
const onlyDetected = document.querySelector("#only-detected");
const template = document.querySelector("#result-card-template");

let results = [];

init().catch((error) => {
  grid.innerHTML = `<p class="error-text">Could not load ${resultsUrl}: ${escapeHtml(error.message)}</p>`;
});

async function init() {
  const response = await fetch(resultsUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  results = await response.json();
  onlyDetected.addEventListener("change", render);
  render();
}

function render() {
  const visibleResults = onlyDetected.checked
    ? results.filter((result) => result.defectFound || result.error)
    : results;

  grid.replaceChildren(...visibleResults.map(renderCard));
  renderSummary(results);
}

function renderCard(result) {
  const card = template.content.firstElementChild.cloneNode(true);
  const image = card.querySelector("img");
  const overlay = card.querySelector(".overlay");
  const title = card.querySelector("h3");
  const provider = card.querySelector(".provider");
  const badge = card.querySelector(".badge");
  const meta = card.querySelector(".meta");

  image.src = `${targetBasePath}${result.targetImage}`;
  image.alt = result.targetImage;
  title.textContent = result.targetImage;
  provider.textContent = result.provider;
  if (result.promptVersion) provider.textContent = `${result.provider} / ${result.promptVersion}`;

  if (result.error) {
    badge.textContent = "Error";
    badge.classList.add("error");
  } else if (result.defectFound) {
    badge.textContent = "Detected";
    badge.classList.add("detected");
  } else {
    badge.textContent = "Clear";
    badge.classList.add("clear");
  }

  drawBoxes(overlay, result.detections ?? []);
  meta.replaceChildren(
    metaRow("Latency", `${result.latencyMs}ms`),
    metaRow("Boxes", String((result.detections ?? []).filter((detection) => detection.box).length)),
    metaRow("Detections", String((result.detections ?? []).length)),
    metaRow("Error", result.error ?? "none"),
  );

  return card;
}

function drawBoxes(svg, detections) {
  svg.setAttribute("viewBox", "0 0 256 256");
  svg.replaceChildren();

  detections
    .filter((detection) => detection.box)
    .forEach((detection) => {
      const { x1, y1, x2, y2 } = detection.box;
      const width = Math.max(1, x2 - x1);
      const height = Math.max(1, y2 - y1);
      const label = `${detection.label}${typeof detection.confidence === "number" ? ` ${detection.confidence.toFixed(2)}` : ""}`;

      const rect = createSvgElement("rect", {
        x: x1,
        y: y1,
        width,
        height,
      });
      const labelWidth = Math.max(48, Math.min(170, label.length * 7 + 12));
      const labelY = Math.max(0, y1 - 22);
      const labelBg = createSvgElement("rect", {
        class: "label-bg",
        x: x1,
        y: labelY,
        width: labelWidth,
        height: 20,
        rx: 3,
      });
      const text = createSvgElement("text", {
        x: x1 + 6,
        y: labelY + 14,
      });
      text.textContent = label;

      svg.append(rect, labelBg, text);
    });
}

function metaRow(label, value) {
  const fragment = document.createDocumentFragment();
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = label;
  dd.textContent = value;
  fragment.append(dt, dd);
  return fragment;
}

function renderSummary(allResults) {
  const failures = allResults.filter((result) => result.error).length;
  const detections = allResults.reduce((count, result) => count + (result.detections?.length ?? 0), 0);
  const detectedImages = allResults.filter((result) => result.defectFound).length;
  summary.textContent = `${allResults.length} results | ${detectedImages} images detected | ${detections} detections | ${failures} failures`;
}

function createSvgElement(name, attributes) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[char];
  });
}
