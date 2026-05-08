# Sightline MVP End-to-End Spec

Sightline is a durable defect-inspection workflow. The user defines a defect with a reference image and description, inspects up to 25 target images, reviews results, corrects mistakes, retries failures, and returns later to the same inspection.

## 0. North Star

Given one reference image, one defect description, and up to 25 targets, a user can:

1. Create an inspection.
2. Watch inspection progress.
3. Review every target result.
4. Correct wrong results.
5. Retry failed targets.
6. Leave, return, and continue from durable state.

## 1. Current Baseline

Already implemented:

- Gemini analyzer adapter.
- Local sample images.
- Spike CLI.
- Visual box review page.
- Local prototype app at `/prototype/`.
- File-backed uploads in `uploads/<jobId>/`.
- File-backed jobs in `jobs/<jobId>/job.json`.
- Progress polling.
- Basic result grid.
- Browser-drawn bounding boxes.

Current gap:

- Jobs are durable on disk, but the UI does not yet make durability the central product behavior.

## 2. MVP Versions

## V0.1 — Durable Inspection Library

Goal: make stored inspections visible and reopenable.

### User Flow

1. User opens `/prototype/`.
2. User sees an inspection library, not a blank upload form.
3. User sees existing jobs from `jobs/index.json`.
4. User clicks an inspection.
5. The app loads `jobs/<jobId>/job.json`.
6. The app renders the current state, whether running or completed.

### Data

Use existing local files:

```text
jobs/index.json
jobs/<jobId>/job.json
uploads/<jobId>/*
```

Library row fields:

- reference thumbnail
- defect description
- status
- created time
- processed / total
- detected count
- failed count

### UI States

- Empty library: `Start your first inspection`.
- Running job row: status badge `running`.
- Completed job row: status badge `completed`.
- Failed or partially failed job row: visible failure count.

### Acceptance Test

1. Create an inspection.
2. Refresh the browser.
3. See the inspection in the library.
4. Reopen it.
5. Results and boxes are still visible.

## V0.2 — Split Workflow Modes

Goal: stop treating the app as one screen. Make the product loop explicit.

### Modes

One app, four modes:

- `library`
- `new`
- `running`
- `review`

Routing can be client-side hash or query param for the local prototype:

```text
/prototype/#/
/prototype/#/new
/prototype/#/jobs/<jobId>
```

### Behavior

- Library is home.
- `New inspection` opens the creation form.
- Submitting creates a job and moves to running/review mode.
- Reopening a job chooses running or review based on job status.
- Refresh preserves the current job view.

### Acceptance Test

1. Open app.
2. Start new inspection.
3. Submit job.
4. Refresh while running.
5. App returns to same job.
6. When complete, app shows review mode.

## V0.3 — Result Review Buckets

Goal: make completed inspections answerable in under 5 seconds.

### Buckets

Implement:

- `All`
- `Defect`
- `Clean`
- `Failed`

Do not implement:

- `Low confidence`
- threshold slider
- confidence sorting

Reason: Gemini confidence is not calibrated enough for product decisions.

### Derived Categories

For each target:

```text
failed = latest result has error
defect = latest result defectFound true and not rejected by feedback
clean = latest result defectFound false and no failure
queued/running = no terminal result yet
```

### UI

Review header:

```text
5 of 5 inspected · 2 with defect · 0 failed
```

Filters:

```text
[All 5] [Defect 2] [Clean 3] [Failed 0]
```

### Acceptance Test

1. Open a completed five-target inspection.
2. Header counts match grid results.
3. Each filter shows only matching targets.
4. Failed targets remain visible and retryable.

## V0.4 — Image Detail Review

Goal: make one-target review and navigation possible.

### User Flow

1. User clicks a target tile.
2. Detail view opens.
3. User sees the target image, overlay boxes, status, filename, latency, and result reason.
4. User can move to previous/next target.
5. User can return to result review.

### Controls

V1 controls:

- `Mark correct`
- `Mark wrong`
- `Retry target` only when failed
- `Previous`
- `Next`

Deferred:

- manual box drawing
- threshold slider
- zoom/pan

### Acceptance Test

1. Open result detail for target 3.
2. Navigate next and previous.
3. Return to review grid.
4. Refresh on detail URL and stay on same target.

## V0.5 — Feedback Persistence

Goal: make human correction part of the workflow.

### Data Model

Add to `job.json`:

```ts
type Feedback = {
  id: string;
  targetImageId: string;
  resultTargetImage: string;
  kind: "confirm" | "reject";
  createdAt: string;
};
```

Rules:

- Do not mutate analyzer results.
- Add feedback rows.
- Latest feedback for a target determines displayed correction.

### Display Logic

```text
defect =
  analyzer defectFound true
  unless latest feedback is reject
```

For v0.5, `confirm` records review but does not turn a clean result into a defect. Manual positive correction comes later with manual boxes.

### UI

- A rejected defect tile becomes `Clean · marked wrong`.
- A confirmed defect tile becomes `Defect · confirmed`.
- Detail view shows review state.

### Acceptance Test

1. Open a defect result.
2. Mark wrong.
3. Return to grid.
4. Defect count decreases by one.
5. Refresh page.
6. Correction persists.

## V0.6 — Retry Failed Target

Goal: recover from partial failure without losing completed work.

### Data Model

Add attempts:

```ts
type AnalysisAttempt = {
  id: string;
  targetImageId: string;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  completedAt?: string;
  result?: AnalyzerResult;
};
```

For the local MVP, this can be represented minimally by appending a new result with:

- same target image
- new `attemptId`
- new latency/result/error

### Behavior

- Retry runs Gemini for one target only.
- Old failed result remains in job history.
- Latest attempt determines displayed state.
- Other targets do not rerun.

### Acceptance Test

1. Force or create a failed target.
2. Click `Retry target`.
3. Target changes to running.
4. Target completes or fails again.
5. Other target results are unchanged.

## V0.7 — Sample Demo Inspection

Goal: let a new evaluator understand Sightline without preparing files.

### Behavior

Add `Load sample inspection`.

Options:

- If no sample job exists, create one from `samples/reference` and `samples/targets`.
- If a sample job exists, reopen it.

### Acceptance Test

1. Fresh clone or empty `jobs/`.
2. Open `/prototype/`.
3. Click `Load sample inspection`.
4. See a complete or running inspection with real sample images.

## V0.8 — MVP Polish Pass

Goal: make the local MVP feel intentional and demoable.

### Required Polish

- All states covered: empty, loading, running, completed, partial failure, all failed.
- Buttons use product vocabulary: `Start inspection`, `Retry target`, `Mark wrong`.
- No provider names in default UI.
- Debug drawer shows provider/prompt/raw response only when opened.
- No layout shift as targets move from queued to running to complete.
- Mobile layout remains readable.

### Acceptance Test

Give a new user the local URL and one sentence:

```text
Inspect these images for the kind of defect in this reference.
```

They can complete the whole workflow without explanation.

## 3. Final MVP Deliverable

The MVP deliverable is a local, file-backed Sightline workflow app with:

- Inspection library.
- New inspection form.
- Durable job state.
- Gemini-backed inspection.
- Progress polling.
- Result review with buckets.
- Browser-drawn boxes.
- Image detail view.
- Confirm/reject feedback.
- Retry failed target.
- Sample demo inspection.

It is acceptable that the MVP is local-only.

It is not acceptable for the MVP to lose jobs on refresh, hide failures, or require the user to understand the analyzer implementation.

## 5. Bottleneck

The core loop is:

```text
define defect -> inspect targets -> review results -> correct mistakes -> return later
```

The current bottleneck is `return later`.
