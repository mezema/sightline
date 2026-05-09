# Sightline

Sightline is a durable defect-inspection workflow system.

A user provides one reference image, a written defect description, and up to 25 target images. Sightline stores the inspection, runs image analysis in the background, and lets a human review detections, correct results, retry failed targets, and return later.

The product is the workflow: private uploads, durable processing, reviewable results, human feedback, and safe retry behavior.

```mermaid
flowchart LR
  user["User"] --> spec["Reference image + defect description"]
  spec --> targets["Target images"]
  targets --> job["Durable inspection"]
  job --> worker["Background processing"]
  worker --> review["Review detections"]
  review --> feedback["Feedback + retry"]
  feedback --> job
```

## What It Does

Sightline answers one user request:

> Here is the defect I care about. Here is an example image. Check these other images and show me where similar defects appear.

The MVP is successful when a user can sign in, create an inspection, leave or refresh while processing continues, reopen the inspection from the library, see progress and failures, review boxes over detected defects, mark results correct or wrong, and retry a failed target without rerunning the whole inspection.

If jobs disappear on refresh, failed targets are hidden, images are public by default, or the user has to understand the analyzer provider, the product is not done.

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
| Tests | Node test runner, Playwright browser tests |
| Observability | Sentry package installed, OpenTelemetry later |

## Architecture

Postgres is the source of truth. R2 stores private image blobs. Trigger.dev owns background execution. Gemini is only an adapter.

```mermaid
flowchart TD
  browser["Browser / Next.js UI"] --> server["Next.js server layer<br/>API routes, auth, signed URLs"]
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

Hard rules:

- Postgres owns durable workflow state.
- R2 owns image bytes.
- Trigger.dev owns slow background execution.
- Analyzer output is immutable.
- Human feedback is additive.
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

## Local Setup

This path runs the app with local Postgres and the deterministic fake analyzer.

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

Open `http://localhost:3000`.

## Full Local Setup

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

Create a Cloudflare API token with R2 edit permission, then add it to `.env.local`:

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

Production uses hosted services with the same architecture as local.

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

Create a Clerk production app, Neon production database, Cloudflare R2 private bucket, Trigger.dev project, and Vercel project.

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

### 4. Configure R2 CORS

Add production origins to the R2 CORS config before applying it:

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

Also confirm `SIGHTLINE_JOB_QUEUE=trigger`, `TRIGGER_SECRET_KEY`, and `TRIGGER_PROJECT_ID`.

### The app redirects or Clerk loops

Make sure the Clerk publishable key and secret key belong to the same Clerk app.

### Images show placeholders

The image asset exists in Postgres, but upload verification did not complete. Create a fresh inspection or retry the upload flow.

### Node warns about the engine

The repo expects Node 24 or newer.

## More Detail

- [Requirements](docs/requirements.md)
- [Analyzer contract](docs/analyzer-contract.md)
- [Roadmap](docs/roadmap.md)
- [Legacy tools](docs/legacy-tools.md)
