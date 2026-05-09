# Sightline

Sightline is a durable defect-inspection workflow system.

A user gives Sightline:

```text
1 reference image
1 defect description
up to 25 target images
```

Sightline stores the inspection, runs image inspection in the background, then lets a human review, correct, retry, and return later.

The product is the workflow, not the model.

```mermaid
flowchart LR
  user["User"] --> spec["Defect spec<br/>reference + description"]
  spec --> targets["Target images"]
  targets --> job["Durable inspection"]
  job --> worker["Background processing"]
  worker --> review["Review boxes"]
  review --> feedback["Feedback + retry"]
  feedback --> job
```

## What We Want

Sightline should let a user say:

> Here is the defect I care about. Here is an example image. Check these other images and show me where similar defects appear.

The system should accept images, store them privately, create a durable inspection, run slow external analysis in the background, survive refreshes and failures, and return reviewable results that a human can correct.

The MVP is successful when a user can:

1. Sign in.
2. Create an inspection with one reference image, one defect description, and up to 25 target images.
3. Leave or refresh while processing continues.
4. Reopen the same inspection from the library.
5. See progress and partial failures.
6. Review target images with boxes over detected defects.
7. Mark results correct or wrong.
8. Retry a failed target without rerunning the whole inspection.

The MVP is not successful if jobs disappear on refresh, failed targets are hidden, images are public by default, or the user needs to understand the analyzer provider.

## Requirements

### Product Requirements

| Requirement | Owner | Status |
| --- | --- | --- |
| One reference image defines the defect example. | Product | Built |
| A written defect description explains what to find. | Product | Built |
| A user can inspect up to 25 target images per inspection. | Product | Built |
| An inspection persists after refresh, navigation, or return visits. | Product + Engineering | Built |
| Progress is visible while processing runs. | Product + UX | Built with polling |
| Results are reviewable per target image. | Product + UX | Built |
| Failed targets remain visible. | Product + UX | Built |
| A failed target can be retried independently. | Product | Built |
| Human feedback is stored without overwriting analyzer output. | Product + Engineering | Built |

### Engineering And Security Requirements

| Requirement | Owner | Status |
| --- | --- | --- |
| Postgres is the source of truth for workflow state. | Engineering | Built |
| Object storage owns image bytes. | Engineering | Built |
| The browser uploads images through short-lived upload URLs. | Engineering + Security | Built |
| Jobs run outside the browser in a background worker. | Engineering | Built |
| Analyzer output is normalized before it reaches the UI. | Engineering | Built |
| Provider-specific response formats stay behind an adapter boundary. | Engineering | Built |
| Each result write is tied to a processing attempt. | Engineering | Built |
| Users can only access their own inspections and images. | Security | Built when Clerk is configured |
| Retention and permanent deletion policy is explicit. | Product + Compliance | Still needed |

### Analyzer Contract Requirements

These are the most important remaining unknowns before treating Sightline as production-ready with a real analyzer.

| Requirement | Owner | Status |
| --- | --- | --- |
| Confirm whether analysis is one target per request or batch-based. | External analyzer owner | Still needed |
| Confirm latency p50/p95 and rate limits. | External analyzer owner | Still needed |
| Confirm whether webhooks are available. | External analyzer owner | Still needed |
| Confirm output schema: defect flag, confidence, boxes, masks, annotated image, errors. | External analyzer owner | Partly built around boxes |
| Confirm bounding-box coordinate system. | External analyzer owner | Built for Gemini normalized boxes |
| Confirm privacy terms for uploaded images. | Product + Compliance | Still needed |
| Confirm idempotency and retry semantics. | External analyzer owner + Engineering | Still needed |

## How Sightline Meets The Requirements

| Need | How Sightline does it | Benefit |
| --- | --- | --- |
| Durable inspections | Postgres stores inspections, targets, attempts, results, detections, feedback, and events. | Work survives refreshes, retries, worker failures, and return visits. |
| Private image handling | Cloudflare R2 stores image blobs; the database stores metadata and storage keys. | Images are not mixed into job messages or application state. |
| Slow external analysis | Trigger.dev or the local queue runs one processing attempt per target image. | The browser is not blocked by analyzer latency. |
| Reviewable results | Analyzer responses are normalized into `Result` and `Detection` records. | The UI can show stable boxes and statuses regardless of provider format. |
| Human correction | Feedback rows are additive and do not mutate raw analyzer output. | The system keeps an audit trail and can compare analyzer output to review decisions. |
| Partial failure handling | Each target has its own attempt/result lifecycle. | One failed image does not invalidate the whole inspection. |
| Replaceable infrastructure | Core rules live behind ports for storage, jobs, and analyzers. | R2, Trigger.dev, Gemini, or Postgres can be replaced with less product churn. |

## What Can Still Be Improved

The next improvements should be driven by the current bottleneck: the real analyzer contract.

1. **Analyzer contract and spike**
   Run a small real-analyzer test with one reference, one description, and five targets. Record latency, rate limits, batch support, webhook support, output schema, error shape, retry behavior, and privacy terms.

2. **Reliability hardening**
   Add stronger duplicate-result handling, stuck-job reconciliation, analyzer-request tracking, and an outbox publisher if queue publication needs stricter guarantees.

3. **Operational dashboard**
   Track upload failures, queue depth, attempt wait time, analyzer latency p50/p95/p99, analyzer error rate, retry count, partial failure rate, and job completion time.

4. **Realtime progress**
   Polling is enough for MVP. If progress needs to feel live, add SSE, Trigger.dev realtime, or another one-way update path before considering custom WebSockets.

5. **Security, retention, and compliance**
   Define retention periods, permanent deletion behavior, tenant isolation, signed URL lifetime, and whether the external analyzer stores or trains on customer images.

6. **Product review tools**
   Add manual box correction, false positive/false negative reasons, project or collection organization, exports, and report generation once the core workflow is stable.

7. **Scale and cost controls**
   Add measured concurrency limits, per-user or per-tenant quotas, thumbnail generation, batch analyzer support if available, and load tests for 1, 10, and 100 simultaneous inspections.

## Current Stack

| Layer | Tool |
| --- | --- |
| App | Next.js App Router, React, TypeScript, Tailwind CSS |
| Hosting | Vercel |
| Package manager | pnpm workspaces |
| Auth | Clerk |
| Database | Postgres, Neon in production |
| ORM | Drizzle schema and SQL migrations |
| Object storage | Cloudflare R2, private bucket |
| Jobs | Trigger.dev |
| Analyzer | Fake analyzer for development, Gemini for MVP |
| Tests | Node test runner today, Playwright browser tests |
| Observability | Sentry package installed, OpenTelemetry later |

## The Architecture

Postgres is the source of truth. R2 stores private image blobs. Trigger.dev owns execution. Gemini is only an adapter.

```mermaid
flowchart TD
  browser["Browser / Next.js UI<br/>upload, library, review, feedback"] --> server["Next.js server layer<br/>API routes, auth, signed URLs"]
  server --> postgres["Postgres<br/>inspections, targets, attempts, results, detections, feedback"]
  server --> r2["Cloudflare R2<br/>private original images"]
  postgres --> trigger["Trigger.dev worker<br/>one task per processing attempt"]
  trigger --> r2
  trigger --> analyzer["DefectAnalyzer port"]
  analyzer --> gemini["Gemini adapter"]
  analyzer --> fake["Fake analyzer"]
  trigger --> postgres
  postgres --> browser
```

### Why It Is Built This Way

Sightline optimizes for one thing: inspections survive refreshes, retries, analyzer failures, and return visits.

The hard rules:

- Postgres owns durable workflow state.
- R2 owns image bytes.
- Trigger.dev owns slow background execution.
- Analyzer output is immutable.
- Human feedback is additive.
- Cached counters can be rebuilt.
- Provider formats never reach the UI.
- Bounding boxes are stored as pixel coordinates against the original image.

## Repository Map

```text
sightline/
  apps/web/              Next.js app, routes, UI, server adapters
  packages/core/         domain types, ports, workflow use cases
  packages/db/           Drizzle schema, migrations, processing store
  packages/storage/      Cloudflare R2 adapter
  packages/analyzer/     fake + Gemini analyzer adapters
  packages/jobs/         Trigger.dev tasks
  packages/ui/           shared UI primitives
  infra/                 operational config, including R2 CORS
  tests/                 unit and adapter tests
```

Important boundary:

```text
packages/core must not import Next.js, Clerk, Drizzle, R2, Trigger.dev, or Gemini.
```

Core defines the product rules. Everything else is an adapter.

## Workflow

```mermaid
sequenceDiagram
  participant U as User
  participant W as Web app
  participant DB as Postgres
  participant R2 as R2
  participant T as Trigger.dev
  participant A as Analyzer

  U->>W: Create inspection
  W->>DB: Create inspection + image assets
  W->>R2: Create signed upload URLs
  U->>R2: Upload images
  W->>R2: Verify objects
  W->>DB: Create targets + attempts
  W->>T: Queue attempts
  T->>DB: Load attempt context
  T->>R2: Read private images
  T->>A: Analyze target
  T->>DB: Save result + detections + counters
  U->>W: Review, mark wrong, retry
```

## Domain Objects

| Object | Meaning |
| --- | --- |
| Inspection | One durable job |
| Defect spec | Reference image plus written description |
| Image asset | Private reference or target image metadata |
| Inspection target | Stable row for one target image |
| Processing attempt | One try at inspecting one target |
| Result | Analyzer outcome for one target attempt |
| Detection | One normalized pixel bounding box |
| Feedback | Human correction layered on analyzer output |
| Job event | Audit trail |

## Local Setup

### 1. Install

Use Node 24 or newer.

```sh
corepack enable
pnpm install
```

### 2. Create `.env.local`

```sh
cp .env.example .env.local
```

For the simplest local loop, keep:

```sh
ANALYZER_PROVIDER=fake
DATABASE_URL=postgres://sightline:sightline@localhost:5436/sightline
SIGHTLINE_APP_URL=http://localhost:3000
```

Clerk is optional locally. If Clerk env vars are missing, Sightline uses a seeded dev owner.

### 3. Start Postgres

```sh
docker compose up -d postgres
pnpm --filter @sightline/db db:apply
```

### 4. Start the App

```sh
pnpm dev
```

Open:

```text
http://localhost:3000
```

That is enough for the fake-analyzer workflow.

## Real Local Workflow

Use this when you want the full R2 + Trigger.dev + Gemini loop.

### 1. Fill Real Env Vars

Add these to `.env.local`:

```sh
ANALYZER_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash

R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=sightline-private-dev
SIGHTLINE_UPLOAD_MODE=direct

SIGHTLINE_JOB_QUEUE=trigger
TRIGGER_PROJECT_ID=...
TRIGGER_SECRET_KEY=...

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
```

### 2. Configure R2 CORS

Create a Cloudflare API token with:

```text
Account -> Workers R2 Storage -> Edit
Account resources -> Include your account
```

Then add it to `.env.local`:

```sh
CLOUDFLARE_API_TOKEN=...
```

Apply and verify CORS:

```sh
pnpm run r2:cors
pnpm run r2:cors:list
```

Expected local CORS:

```text
allowed_origins:  http://localhost:3000, http://127.0.0.1:3000
allowed_methods:  PUT, GET, HEAD
allowed_headers:  *
```

If CORS is not ready yet, use same-origin server upload mode:

```sh
SIGHTLINE_UPLOAD_MODE=server
```

Production should use:

```sh
SIGHTLINE_UPLOAD_MODE=direct
```

### 3. Run Trigger.dev Locally

Terminal 1:

```sh
pnpm exec trigger dev --env-file .env.local --skip-update-check
```

Terminal 2:

```sh
pnpm dev
```

### 4. Acceptance Pass

In the browser:

```text
1. Sign in
2. Create an inspection
3. Upload 1 reference and 5 targets
4. Refresh while processing
5. Reopen from the library
6. Review boxes
7. Mark one result wrong
8. Retry one failed target, if any
```

No step should require knowing Gemini exists.

## Environment Variables

| Variable | Required for | Notes |
| --- | --- | --- |
| `DATABASE_URL` | DB-backed app | Local Postgres or Neon |
| `SIGHTLINE_APP_URL` | local image URLs | Usually `http://localhost:3000` |
| `ANALYZER_PROVIDER` | analyzer choice | `fake` or `gemini` |
| `GEMINI_API_KEY` | Gemini | Server/worker only |
| `GEMINI_MODEL` | Gemini | Defaults to Gemini 2.5 Flash in code |
| `R2_ACCOUNT_ID` | R2 | Cloudflare account id |
| `R2_ACCESS_KEY_ID` | R2 | S3-compatible access key |
| `R2_SECRET_ACCESS_KEY` | R2 | S3-compatible secret |
| `R2_BUCKET` | R2 | Private bucket name |
| `SIGHTLINE_UPLOAD_MODE` | uploads | `direct` or `server` |
| `SIGHTLINE_JOB_QUEUE` | jobs | Use `trigger` for Trigger.dev |
| `TRIGGER_PROJECT_ID` | Trigger.dev | Project ref |
| `TRIGGER_SECRET_KEY` | Trigger.dev | Dev/prod secret key |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk | Browser-safe |
| `CLERK_SECRET_KEY` | Clerk | Server-only |
| `CLOUDFLARE_API_TOKEN` | R2 CORS command | Needs R2 edit permission |

## Production Setup

The production shape is the same as local, but with hosted services.

```mermaid
flowchart LR
  vercel["Vercel<br/>Next.js app"] --> neon["Neon Postgres"]
  vercel --> r2["Cloudflare R2"]
  vercel --> clerk["Clerk"]
  trigger["Trigger.dev cloud"] --> neon
  trigger --> r2
  trigger --> gemini["Gemini API"]
```

### 1. Create Services

Create:

- Clerk production app
- Neon production database
- Cloudflare R2 private bucket
- Trigger.dev project
- Vercel project

### 2. Set Production Env Vars

Set app env vars in Vercel:

```text
DATABASE_URL
SIGHTLINE_APP_URL
ANALYZER_PROVIDER=gemini
GEMINI_API_KEY
GEMINI_MODEL
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
SIGHTLINE_UPLOAD_MODE=direct
SIGHTLINE_JOB_QUEUE=trigger
TRIGGER_PROJECT_ID
TRIGGER_SECRET_KEY
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
```

Set worker env vars in Trigger.dev too:

```text
DATABASE_URL
ANALYZER_PROVIDER=gemini
GEMINI_API_KEY
GEMINI_MODEL
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
SIGHTLINE_JOB_QUEUE=trigger
TRIGGER_PROJECT_ID
TRIGGER_SECRET_KEY
```

### 3. Run Migrations

Point `DATABASE_URL` at Neon, then run:

```sh
pnpm --filter @sightline/db db:apply
```

### 4. Configure R2 CORS for Production

Add your production origin to the R2 CORS config before applying it.

Example:

```json
{
  "rules": [
    {
      "id": "sightline-browser-uploads",
      "allowed": {
        "origins": [
          "https://your-production-domain.com",
          "https://your-vercel-project.vercel.app"
        ],
        "methods": ["PUT", "GET", "HEAD"],
        "headers": ["*"]
      },
      "exposeHeaders": ["ETag"],
      "maxAgeSeconds": 3600
    }
  ]
}
```

Then run:

```sh
pnpm run r2:cors
```

### 5. Deploy

Deploy the web app through Vercel.

Deploy Trigger.dev tasks:

```sh
pnpm exec trigger deploy --env prod --env-file .env.local
```

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start Next.js app |
| `pnpm build` | Build Next.js app |
| `pnpm -r --if-present typecheck` | Typecheck workspace |
| `node --test tests/*.test.ts` | Run unit tests |
| `pnpm --filter @sightline/db db:apply` | Apply SQL migrations |
| `pnpm exec trigger dev --env-file .env.local --skip-update-check` | Run Trigger tasks locally |
| `pnpm run r2:cors` | Apply R2 CORS |
| `pnpm run r2:cors:list` | Inspect R2 CORS |

## Testing

Run the fast checks:

```sh
pnpm -r --if-present typecheck
node --test tests/*.test.ts
pnpm --filter @sightline/web build
```

Run DB integration tests when `DATABASE_URL` is set:

```sh
pnpm test:integration
```

Run browser tests:

```sh
pnpm --filter @sightline/web test:browser
```

If Playwright browsers are missing:

```sh
pnpm --filter @sightline/web exec playwright install
```

## Troubleshooting

### R2 uploads fail with CORS

Run:

```sh
pnpm run r2:cors
pnpm run r2:cors:list
```

Make sure the current app origin is listed. For local direct uploads, `http://localhost:3000` must be allowed.

### Trigger runs stay queued

Check:

```sh
pnpm exec trigger dev --env-file .env.local --skip-update-check
```

Also confirm:

```text
SIGHTLINE_JOB_QUEUE=trigger
TRIGGER_SECRET_KEY is present
TRIGGER_PROJECT_ID is present
```

### The app redirects or Clerk loops

Make sure the Clerk publishable key and secret key belong to the same Clerk app.

### Images show placeholders

The image asset exists in Postgres, but upload verification did not complete. Create a fresh inspection or retry the upload flow.

### Node warns about the engine

The repo expects Node 24 or newer. Install Node 24+ for the cleanest local setup.

## Legacy Tools

The repo still includes the earlier analyzer spike and local prototype. They are useful for reality checks, but the product app is `apps/web`.

Run the analyzer spike:

```sh
node src/run-spike.ts --description "scratch near left edge"
```

Run the old local prototype:

```sh
GEMINI_API_KEY="..." node src/prototype-server.ts
```

Open:

```text
http://localhost:4173/prototype/
```

## Product Principle

Sightline should make this boring:

```text
Create inspection -> upload privately -> process in background -> review boxes -> correct -> retry -> return later
```

If jobs disappear on refresh, failed targets are hidden, images are public by default, or the user has to understand the analyzer provider, the product is not done.
