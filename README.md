# Sightline Analyzer Spike

Command-line spike for comparing LandingAI LandingLens and Gemini bounding-box detection on the same local defect-inspection batch.

## Setup

Use Node.js 24 or newer.

```sh
export GEMINI_API_KEY="..."
export LANDINGAI_API_KEY="..."
export LANDINGAI_ENDPOINT_ID="..."
```

Place images here:

```text
samples/
  reference/
    reference.jpg
  targets/
    target-01.jpg
    target-02.jpg
```

## Run

```sh
node src/run-spike.ts --description "scratch near left edge"
```

Optional flags:

```sh
node src/run-spike.ts \
  --description "scratch near left edge" \
  --providers gemini,landingai \
  --max-targets 5 \
  --output-dir outputs
```

Outputs:

- `outputs/results.json`
- `outputs/report.md`

## Tests

```sh
node --test tests/*.test.ts
```

## Visual Review

After a spike run, start a local static server from the project root:

```sh
node -e "const http=require('node:http');const fs=require('node:fs');const path=require('node:path');const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.jpg':'image/jpeg'};http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');let pathname=decodeURIComponent(url.pathname);if(pathname==='/'||pathname==='/review/')pathname='/review/index.html';const file=path.join(process.cwd(),pathname);fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);res.end('not found');return}res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream'});res.end(data)})}).listen(4173,()=>console.log('http://localhost:4173/review/'))"
```

Open `http://localhost:4173/review/` to inspect target images with overlayed boxes.

## Local Prototype App

Run the file-backed inspection workflow:

```sh
GEMINI_API_KEY="..." node src/prototype-server.ts
```

Open `http://localhost:4173/prototype/`.

The prototype stores uploaded files under `uploads/<jobId>/` and durable job state under `jobs/<jobId>/job.json`. It is intentionally local-only: no auth, no database, no object storage, and no production queue.

## Provider Notes

Gemini boxes are expected as `box_2d: [y0, x0, y1, x1]` normalized from `0..1000`; the spike converts them to pixel coordinates.

LandingAI/LandingLens response shapes can vary by deployment and workflow. The adapter accepts common prediction shapes and preserves the raw response for contract refinement.
