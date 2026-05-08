# Sightline Product Spec

Sightline is a defect-inspection workflow system. A user defines the defect they care about with a reference image and description, uploads target images, waits while an external analyzer inspects them, then reviews and corrects the results.

The product is not the model. The product is the durable workflow around image intake, async inspection, result review, correction, retry, and return visits.

## 1. Product Goal

Sightline should let a user say:

> Here is the defect I care about. Here is an example image. Check these other images and show me where similar defects appear.

The system must:

1. Accept reference and target images safely.
2. Persist an inspection as a durable artifact.
3. Run external image analysis without blocking the browser.
4. Survive retries, refreshes, crashes, and partial failures.
5. Normalize analyzer output into reviewable results.
6. Let humans confirm, reject, retry, and return later.

## 2. MVP Success Criteria

The hosted MVP is successful when a new user can:

1. Sign in.
2. Create an inspection with one reference image, a defect description, and up to 25 targets.
3. Leave or refresh during processing.
4. Reopen the same inspection from the library.
5. See live or polling progress.
6. Review all results with boxes drawn over images.
7. See failed targets in place.
8. Mark results correct or wrong.
9. Retry one failed target without rerunning the whole inspection.

The MVP is not successful if jobs disappear on refresh, failed targets are hidden, images are public by default, or the user must understand the analyzer provider.

Analyzer usefulness gate:

- On the sample defect dataset, boxes render in the correct position over the original images.
- Results are plausible enough for human review: obvious defect examples are surfaced, clear examples are not all flagged, and failures are visible.
- Gemini remains acceptable for MVP only as a workflow analyzer. It is not treated as final QA authority.

## 3. Product Vocabulary

Use these names in UI, code, API, docs, and support.

- **Inspection**: one durable job.
- **Reference**: the example image showing the defect.
- **Defect spec**: reference plus written description.
- **Targets**: images being inspected.
- **Processing attempt**: one try at inspecting one target.
- **Detection**: one bounding box on one target.
- **Result**: one target's outcome plus detections/errors.
- **Feedback**: human correction layered on top of analyzer output.

Do not use `scan`, `prediction`, `analysis`, or `test` as UI/product-facing nouns.

## 4. Scope

### MVP In Scope

- Email/password or magic-link auth.
- Single-user or single-workspace ownership model.
- Inspection library.
- New inspection flow.
- Private image storage.
- Durable inspection/target/attempt/result persistence.
- Background processing.
- Gemini analyzer adapter as the initial analyzer.
- Review grid with `All`, `Defect`, `Clean`, `Failed`.
- Image detail with previous/next navigation.
- Browser-drawn bounding boxes.
- Confirm/reject feedback.
- Retry target.
- Basic debug drawer for provider/prompt/raw response.
- Basic operational metrics and structured logs.

### MVP Out Of Scope

- LandingAI/Roboflow provider work.
- Custom trained models.
- Multi-tenant enterprise administration.
- Manual box drawing.
- Confidence threshold slider.
- PDF report designer.
- Saved templates.
- Billing.
- Public sharing.
- Mobile-native app.

## 5. Recommended Architecture

Use a boring, durable architecture first.

```text
Browser / Next.js app
        |
        v
Server actions / API routes
        |
        +--------------------+
        |                    |
        v                    v
Postgres                Object storage
system of record        private image blobs
        |
        v
Background job runner
        |
        v
DefectAnalyzer adapter
        |
        v
External analyzer
        |
        v
Result transaction -> progress update -> UI polling/SSE
```

Default implementation choices:

| Layer | Choice | Reason |
| --- | --- | --- |
| Web app | Next.js | Good fit for forms, server actions, and hosted UI. |
| Database | Postgres | Durable system of record with transactions and constraints. |
| Object storage | S3-compatible private bucket | Store original and derived image artifacts outside DB. |
| Background jobs | Durable job runner with retries/concurrency | Analyzer calls are slow and failure-prone. |
| Analyzer | Gemini adapter first | Already proven enough for prototype workflow. |
| Progress | Polling first, SSE later | Realtime is enhancement, not source of truth. |

Do not use two systems of record for job state. If Convex or another reactive store is introduced later, define ownership and sync explicitly.

## 6. Domain Model

### User

```ts
type User = {
  id: string;
  email: string;
  createdAt: string;
};
```

### Inspection

```ts
type Inspection = {
  id: string;
  ownerUserId: string;
  defectSpecId: string;
  status:
    | "draft"
    | "uploading"
    | "queued"
    | "processing"
    | "completed"
    | "partially_failed"
    | "failed"
    | "cancelled";
  targetCount: number;
  // Cached counters. Authoritative state comes from targets, attempts, results, detections, and feedback.
  processedCount: number;
  failedCount: number;
  // Targets currently shown in the Defect bucket after feedback is applied.
  defectCount: number;
  createdAt: string;
  submittedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
};
```

Inspection counters are denormalized for library/list performance. They must be updated transactionally with result/feedback writes and must be rebuildable by a reconciler.

### DefectSpec

```ts
type DefectSpec = {
  id: string;
  ownerUserId: string;
  inspectionId: string;
  referenceImageId: string;
  description: string;
  createdAt: string;
};
```

### ImageAsset

```ts
type ImageAsset = {
  id: string;
  ownerUserId: string;
  inspectionId: string;
  kind: "reference" | "target" | "annotated_result";
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  contentHash?: string;
  uploadStatus: "pending" | "uploaded" | "verified" | "failed";
  createdAt: string;
};
```

### InspectionTarget

Stable row for one target image in an inspection. This owns grid order and survives retries.

```ts
type InspectionTarget = {
  id: string;
  inspectionId: string;
  targetImageId: string;
  position: number;
  // Updated when a new attempt is created. Controls queued/running/failed/succeeded state.
  latestAttemptId?: string;
  // Updated when an attempt succeeds and produces a result. Controls displayed analyzer output.
  latestResultId?: string;
  createdAt: string;
};
```

### ProcessingAttempt

One processing attempt for one target. Retrying a target creates a new attempt; old attempts remain.

```ts
type ProcessingAttempt = {
  id: string;
  inspectionId: string;
  inspectionTargetId: string;
  status:
    | "pending"
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled";
  attempt: number;
  idempotencyKey: string;
  analyzerRequestId?: string;
  lastError?: string;
  startedAt?: string;
  completedAt?: string;
};
```

### InspectionResult

```ts
type InspectionResult = {
  id: string;
  inspectionId: string;
  inspectionTargetId: string;
  attemptId: string;
  defectFound: boolean;
  rawAnalyzerResponse: unknown;
  analyzerProvider: string;
  analyzerVersion?: string;
  resultSchemaVersion: number;
  createdAt: string;
};
```

### Detection

One normalized box from one result. Detections are rows, not only nested JSON, because per-box review and correction are expected product behavior.

```ts
type Detection = {
  id: string;
  inspectionId: string;
  inspectionTargetId: string;
  resultId: string;
  label: string;
  confidence?: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  coordinateSystem: "pixel";
  reason?: string;
  createdAt: string;
};
```

### Feedback

```ts
type Feedback = {
  id: string;
  inspectionId: string;
  inspectionTargetId: string;
  subjectType: "target" | "result" | "detection";
  subjectId?: string;
  verdict: "correct" | "wrong";
  reason?:
    | "false_positive"
    | "false_negative"
    | "wrong_location"
    | "wrong_label"
    | "other";
  note?: string;
  createdByUserId: string;
  createdAt: string;
};
```

Feedback granularity:

- Target-level feedback: mark the whole target result correct/wrong.
- Result-level feedback: mark the latest analyzer conclusion correct/wrong.
- Detection-level feedback: mark one box correct/wrong.

MVP may start with target/result-level controls, but the schema must support detection-level feedback.

### JobEvent

Audit trail for user and system actions.

```ts
type JobEvent = {
  id: string;
  inspectionId: string;
  actorUserId?: string;
  kind:
    | "inspection_created"
    | "uploads_verified"
    | "inspection_submitted"
    | "attempt_started"
    | "attempt_succeeded"
    | "attempt_failed"
    | "feedback_created"
    | "target_retried"
    | "inspection_cancelled";
  payload: unknown;
  createdAt: string;
};
```

### OutboxEvent

Used when queue publication must be made reliable.

```ts
type OutboxEvent = {
  id: string;
  kind: string;
  payload: unknown;
  status: "pending" | "published" | "failed";
  createdAt: string;
  publishedAt?: string;
};
```

## 7. Derived State Rules

Inspection status is derived from the latest attempt for each target.

```text
completed = all latest attempts succeeded
failed = all latest attempts failed
processing = any latest attempt queued/running and not all terminal
partially_failed = all latest attempts are terminal, with at least one succeeded and at least one failed
cancelled = user cancelled remaining non-terminal attempts
```

Displayed target category is derived from latest result plus feedback:

```text
failed = latest attempt failed
defect = latest result defectFound true and no applicable wrong feedback removes the defect
clean = latest result defectFound false OR applicable wrong feedback removes all defects
queued/running = no terminal latest attempt yet
```

Analyzer output is immutable. Human feedback is additive.

Authoritative state:

```text
InspectionTarget + ProcessingAttempt + InspectionResult + Detection + Feedback
```

Cached state:

```text
Inspection.processedCount
Inspection.failedCount
Inspection.defectCount
Inspection.status
InspectionTarget.latestAttemptId
InspectionTarget.latestResultId
```

Cached state exists for fast reads and can be rebuilt.

Retry pointer rules:

- `InspectionTarget.latestAttemptId` is updated immediately when a retry attempt is created.
- `InspectionTarget.latestResultId` is updated only when an attempt succeeds and creates a result.
- The grid state follows `latestAttemptId`.
- The displayed boxes follow `latestResultId`.
- This lets a target show `running` during retry while still preserving old output in history.

Counter rules:

- `processedCount`: targets whose latest attempt is terminal.
- `failedCount`: targets whose latest attempt failed.
- `defectCount`: targets currently shown in the `Defect` bucket after feedback is applied.
- Raw analyzer-only counts belong in metrics/debug views, not the primary library count.

## 8. Upload Flow

1. User starts new inspection.
2. Server creates inspection in `draft` or `uploading`.
3. Server creates expected `ImageAsset` rows.
4. Server issues short-lived signed upload URLs.
5. Browser uploads images directly to private object storage.
6. Browser notifies server uploads are complete.
7. Server verifies object existence, size, MIME type, and count.
8. Server transitions inspection to `queued`.
9. Server creates one `InspectionTarget` per target image.
10. Server creates one initial `ProcessingAttempt` per target.

Rules:

- Target count max is 25.
- Images are private by default.
- Do not send image bytes through the job queue.
- Do not trust client-provided storage keys without ownership checks.
- Original uploaded images are immutable.

## 9. Processing Flow

1. Worker receives processing attempt id.
2. Worker loads attempt, target, inspection, defect spec, reference image, and target image from DB.
3. Worker marks attempt `running`.
4. Worker creates short-lived signed read URLs.
5. Worker calls `DefectAnalyzer`.
6. Worker normalizes response.
7. Worker writes result, detection rows, attempt status, inspection counters, target latest attempt, and event log in one transaction.
8. UI sees progress by polling inspection state.

Analyzer adapter interface:

```ts
interface DefectAnalyzer {
  analyze(input: {
    referenceImageUrl: string;
    targetImageUrl: string;
    defectDescription: string;
    idempotencyKey: string;
  }): Promise<{
    defectFound: boolean;
    detections: Array<{
      label: string;
      confidence?: number;
      box?: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        coordinateSystem: "pixel";
      };
      reason?: string;
    }>;
    rawResponse: unknown;
  }>;
}
```

## 10. UI Screens

Use `ui-design.md` as the visual/product behavior source of truth.

MVP screens:

- Inspection library.
- New inspection.
- Running inspection.
- Result review.
- Image detail.

MVP review buckets:

- `All`
- `Defect`
- `Clean`
- `Failed`

Do not show provider names in the default UI. Put provider, prompt version, latency, and raw response in a debug drawer.

## 10.1 Bounding Box Rules

Bounding boxes are normalized once inside the analyzer adapter, then stored in a provider-independent display format.

Rules:

- Store all detections as pixel coordinates against the original stored image after orientation correction.
- Apply EXIF orientation before measuring width and height.
- Store image width and height after orientation correction on `ImageAsset`.
- Convert provider-native formats into pixel coordinates inside the analyzer adapter.
- UI draws boxes by scaling from natural image size to rendered image size.
- Never use provider-native box formats as the display format.
- Preserve raw provider response separately for debugging and contract changes.

## 11. Reliability Rules

### Database Is Source Of Truth

Object storage stores blobs. Database stores ownership, job state, target state, attempt state, results, detections, feedback, errors, and events.

### Workers Are At-Least-Once

Every processing attempt may be picked up more than once.

Required protections:

- idempotency keys on analyzer calls
- unique processing attempts
- unique result per processing attempt
- duplicate-safe result writes
- retry-safe callbacks if callbacks are added later

### Avoid Dual-Write Loss

MVP can use a reconciler. Production should use an outbox.

MVP reconciler checks:

- queued inspections with no targets or attempts
- queued/running attempts stuck too long
- inspections whose counters disagree with targets/results/feedback
- attempts with analyzer request id but no result past timeout

### Transaction Boundaries

When saving a result:

```text
begin
  insert result
  insert detections
  mark attempt succeeded/failed
  update target latest attempt
  update inspection counters
  append event
commit
```

## 12. Security And Privacy

MVP requirements:

- Auth required for all app routes.
- Every inspection, image, target, attempt, result, detection, and feedback row has an owner.
- Every read/write checks ownership.
- Image bucket is private.
- Image access uses short-lived signed URLs.
- Upload validates count, MIME type, byte size, and image dimensions.
- Raw analyzer responses are not exposed by default.
- Secrets are server-only.
- Define retention before onboarding real customer data.

Open privacy questions before real users:

- Does Gemini store images?
- Are images used for training?
- Are subprocessors involved?
- What retention policy applies to uploaded images and raw responses?

## 13. Observability

Track:

- upload success/failure rate
- inspection creation rate
- queue depth
- attempt queue/wait time
- analyzer latency p50/p95/p99
- analyzer error rate
- retry count
- inspection completion duration
- partial failure rate
- storage usage
- cost per inspection estimate

Every attempt log should include:

- inspection id
- attempt id
- inspection target id
- analyzer provider
- attempt number
- latency
- result status

## 14. Testing

### Unit Tests

- derive inspection status from latest attempt states
- derive review buckets from result + feedback
- derive target state from latest attempt
- reject more than 25 targets
- normalize Gemini boxes
- feedback does not mutate results
- retry creates a new attempt
- detection-level feedback affects only one detection
- box coordinates normalize against post-orientation image dimensions

### Integration Tests

- signed upload flow
- job creation
- attempt processing with fake analyzer
- result transaction
- reopen inspection after refresh
- feedback persistence
- retry failed target

### Fault Tests

- analyzer timeout
- malformed analyzer response
- worker crash after analyzer call
- DB write failure
- missing image object
- duplicate attempt execution
- one failed target in a 25-image inspection

### Browser Acceptance Tests

- create inspection
- watch progress
- refresh while running
- reopen from library
- filter buckets
- open detail
- mark wrong
- retry failed target

## 15. Delivery Plan

### Phase 0 — Reality Contact

Goal: keep analyzer assumptions grounded before building around them.

- Run fake analyzer for deterministic workflow development.
- Run Gemini against 5-25 known sample images.
- Verify response shape, latency, box normalization, raw response storage, and failure modes.
- Confirm boxes render correctly in the review UI.
- Verify obvious defect cases are surfaced.
- Verify obvious clean cases are not all flagged.

Exit criteria:

- analyzer outputs are plausible enough for human review, and fake analyzer can reproduce the workflow without secrets or latency.

### Phase 1 — Product App Foundation

Goal: convert local prototype into hosted app structure.

- Next.js app shell.
- Auth.
- Postgres schema.
- Private object storage adapter.
- Fake analyzer mode.
- Inspection library backed by DB.

Exit criteria:

- user can sign in and create an inspection record with uploaded images stored privately.

### Phase 2 — Durable Processing

Goal: move from local sequential processing to background work.

- Background job runner.
- One processing attempt per target.
- Gemini analyzer adapter using signed read URLs.
- Result transaction.
- Polling progress.
- Reconciler for stuck jobs.

Exit criteria:

- user can submit 25 targets, refresh during processing, and reopen completed results.

### Phase 3 — Review And Correction

Goal: complete the human-in-the-loop workflow.

- Review buckets.
- Detail view.
- Confirm/reject feedback.
- Retry target.
- Debug drawer.

Exit criteria:

- user can correct wrong results and retry failed ones without losing other outputs.

### Phase 4 — Hardening

Goal: make the MVP safe enough for trusted external testing.

- Structured logging.
- Metrics dashboard.
- Rate limits and quotas.
- Upload validation.
- Retention settings.
- Error states and empty states.
- Browser acceptance tests.

Exit criteria:

- trusted tester can complete the workflow without explanation and support can diagnose failures.

## 16. Acceptance Test

The product MVP is done when a tester can:

1. Sign in.
2. Create an inspection with one reference and five targets.
3. Refresh while processing.
4. Reopen from library.
5. See completed review buckets.
6. Open detail for one target.
7. Mark one detected result wrong.
8. Confirm counts update.
9. Retry one failed target.
10. Return the next day and see the same inspection state.

No step may require knowing the analyzer provider.

## 17. Immediate Next Step

Start Phase 1 only after the local prototype has proven both the workflow and the analyzer contract on a small sample dataset. Keep fake analyzer mode and the sample dataset as permanent development tools.

The first implementation target is:

```text
Create the production app scaffold and data model.
```

Specifically:

1. Create `apps/web` Next.js app.
2. Create `packages/core` domain types and use-case interfaces.
3. Add Postgres schema/migrations for inspections, defect specs, image assets, targets, attempts, results, detections, and feedback.
4. Add fake analyzer mode so workflow development is fast and deterministic.
5. Port the local prototype UI screens to the app shell.

Do not add new product features until the hosted app can reproduce the local MVP loop with fake analyzer data.
