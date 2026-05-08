# Sightline UI Design

Sightline is a defect-inspection workflow tool. A user defines a defect once with a reference image and a plain-language description, then asks Sightline to inspect up to 25 target images and show where similar defects appear.

The product is the workflow, not the analyzer. The UI should make inspections durable, reviewable, and correctable even when the analyzer is slow, imperfect, or replaceable.

## 1. Product Stance

| Principle | UI Decision |
| --- | --- |
| Build the workflow, not the model | The primary object is an `Inspection`, not a model response. |
| Reality over polish | First UI must expose running, partial, failed, and completed states. |
| Durable by default | A refresh or closed tab must not lose the job. |
| Human review is part of the system | Analyzer outputs are immutable; user feedback is additive. |
| Avoid fake precision | Gemini confidence is not reliable, so v1 does not include confidence buckets or threshold sliders. |
| Keep provider details out of product UI | Provider and prompt version are debug metadata, not user-facing vocabulary. |

## 2. Vocabulary

Use one word per concept.

- **Inspection**: one durable job.
- **Reference**: the example defect image.
- **Defect spec**: reference plus written description.
- **Targets**: images being inspected.
- **Detection**: one bounding box on one target.
- **Result**: one target's outcome: `queued`, `running`, `defect`, `clean`, or `failed`.
- **Feedback**: a user correction layered on top of analyzer output.

Do not use `analysis`, `prediction`, `scan`, or `test` in the product UI.

## 3. V1 Screen Inventory

Build in this order:

1. **Inspection library**: see durable jobs and reopen them.
2. **New inspection**: create a defect spec and add targets.
3. **Inspection running**: watch target images move through the async job.
4. **Result review**: answer whether defects were found.
5. **Image detail**: confirm, reject, or retry one target.

The shell comes last. For v1, the library is home and `New inspection` is one click away.

## 4. Inspection Library

Purpose: return to a job after refresh, tomorrow, or while another job is running.

```
+----------------------------------------------------------+
| Sightline                                  [New inspection]|
|                                                          |
| Inspections                                              |
|                                                          |
| +----+ Surface crack like the reference     completed    |
| |ref | 5/5 inspected · 2 with defect · 0 failed          |
| +----+ May 8, 2026 · 10:12                              |
|                                                          |
| +----+ Surface crack like the reference     running      |
| |ref | 3/5 inspected · 1 with defect · 0 failed          |
| +----+ May 8, 2026 · 10:20                              |
+----------------------------------------------------------+
```

Load-bearing rules:

- The thumbnail is the reference image, not a generic icon.
- Running and completed jobs live in the same list.
- The summary line is server-computed.
- The defect description is shown verbatim because that is how users remember the job.
- Empty state says `Start your first inspection` and opens the new inspection screen.

## 5. New Inspection

Purpose: create the defect spec and provide target images.

```
+----------------------------------------------------------+
| New inspection                                           |
|                                                          |
| 1. Reference defect                                      |
| +---------------------+  What should Sightline find?     |
| | drop reference      |  [surface crack like ...      ]  |
| | or click to pick    |                                 |
| +---------------------+                                 |
|                                                          |
| 2. Targets                                               |
| +---------------------+ +-----+ +-----+ +-----+          |
| | drop targets        | | 1   | | 2   | | 3   |          |
| | or click to pick    | +-----+ +-----+ +-----+          |
| +---------------------+  7 of 25 added                  |
|                                                          |
| 3. [Start inspection]                                   |
+----------------------------------------------------------+
```

Load-bearing rules:

- No wizard. Reference, description, targets, and start button are visible at once.
- Reference image and description sit under the same heading because together they form the defect spec.
- Show `n of 25` before the limit is hit.
- If more than 25 targets are selected, keep the first 25 and explain that extras were ignored.
- Wrong file types fail per file; valid files continue.
- The submit button explains what is missing while disabled.

## 6. Inspection Running

Purpose: show that slow async work is alive and durable.

```
+----------------------------------------------------------+
| < Inspections                                            |
| Surface crack like the reference                         |
|                                                          |
| Inspecting 5 targets                                     |
| [=======================>        ] 3 / 5                 |
|                                                          |
| +------+ +------+ +------+ +------+ +------+             |
| | box  | | --   | | ...  | | que. | | que. |             |
| +------+ +------+ +------+ +------+ +------+             |
| defect   clean   running queued queued                   |
|                                                          |
| [Cancel inspection]                                      |
+----------------------------------------------------------+
```

Load-bearing rules:

- Tiles never move as state changes.
- Progress bar and tiles show the same truth at different granularity.
- No page-level spinner. The tiles are the progress indicator.
- Refresh returns to the same job state from disk/database.
- Polling is acceptable. Realtime is an enhancement, not the source of truth.
- Cancel marks unprocessed targets `cancelled`; it does not call them failed.

## 7. Result Review

Purpose: answer `did it find what I cared about?` quickly, then support correction.

```
+----------------------------------------------------------+
| < Inspections                                            |
| Surface crack like the reference                         |
| 5 of 5 inspected · 2 with defect · 0 failed              |
|                                                          |
| Defect spec                                              |
| +----------+  "surface crack like the reference image"   |
| | ref img  |                                             |
| +----------+  [Re-run inspection]                        |
|                                                          |
| Filter: [All 5] [Defect 2] [Clean 3] [Failed 0]          |
|                                                          |
| +------+ +------+ +------+ +------+ +------+             |
| |      | |      | | box  | | box  | |      |             |
| +------+ +------+ +------+ +------+ +------+             |
| clean   clean   defect defect clean                      |
+----------------------------------------------------------+
```

Load-bearing rules:

- Header counts are the answer. A user who never scrolls still understands the job.
- Buckets are exhaustive: `All = Defect + Clean + Failed`.
- Failed targets are visible in the same grid, not hidden in a menu.
- Re-run lives with the defect spec because the spec is what the user changes or repeats.
- Provider, prompt version, and raw response stay behind a debug affordance.

V1 buckets:

- `All`
- `Defect`
- `Clean`
- `Failed`

Deferred buckets:

- `Low confidence`
- `Needs review`

Reason: current Gemini confidence is not calibrated enough to drive product behavior.

## 8. Image Detail

Purpose: review one target and correct the system.

```
+----------------------------------------------------------+
| < Result review                 < Prev   3 of 5   Next > |
|                                                          |
| +-----------------------------------+  Result             |
| |                                   |  Defect found       |
| |        target image               |                    |
| |        with overlay boxes         |  Detections         |
| |                                   |  scratch            |
| +-----------------------------------+                    |
|                                                          |
| target-crack-03.jpg                                      |
| Returned in 10.1s                                        |
|                                                          |
| [Mark correct] [Mark wrong] [Retry target]               |
+----------------------------------------------------------+
```

Failed variant:

```
+----------------------------------------------------------+
| +-----------------------------------+  Result             |
| |        target image               |  Failed             |
| +-----------------------------------+                    |
|                                                          |
| Reason: Analyzer timed out                               |
| [Retry target] [Leave failed]                            |
+----------------------------------------------------------+
```

Load-bearing rules:

- Failed results still show the uploaded image.
- Boxes are drawn in the browser from stored coordinates, not baked into the image.
- `Mark correct` and `Mark wrong` write feedback; they do not mutate the analyzer result.
- `Retry target` creates a new attempt and preserves the old output.
- Previous/next navigation is required; users review batches, not isolated pages.

Deferred from v1:

- Manual box drawing.
- Threshold slider.
- Hover-to-isolate detection rows.
- Export-quality annotated image generation.

## 9. Feedback Model

Analyzer output is immutable. Human judgment is additive.

| User action | Persisted as | V1 |
| --- | --- | --- |
| Mark result correct | `feedback.kind = confirm` | Yes |
| Mark result wrong | `feedback.kind = reject` | Yes |
| Retry target | new task attempt | Yes |
| Re-run inspection | new inspection from same inputs | Yes |
| Draw manual box | `feedback.kind = manual_box` | Later |
| Adjust threshold | local view state only | Later |

Displayed conclusion:

```text
defect_found =
  analyzer found a defect and user did not reject it
  OR user added/manual-confirmed defect feedback
```

For v1, because manual boxes are deferred:

```text
defect_found =
  analyzer found a defect and user did not reject it
```

## 10. State Coverage

A screen is not done until these states have explicit visuals.

| State | Library | New | Running | Review | Detail |
| --- | --- | --- | --- | --- | --- |
| Loading | Skeleton rows | n/a | Polling current job | Skeleton tiles | Skeleton image |
| Empty | Start first inspection | Blank form | n/a | No results yet | n/a |
| Partial | Running row | n/a | Default | Supported | Supported |
| All failed | Failed row | n/a | Failed block | Failed grid | Failed variant |
| Refresh | Reopen from index | Preserve form only if cheap | Reopen from job state | Reopen from job state | Reopen from job state |
| Disconnected realtime | n/a | n/a | Keep polling | Keep polling | Keep polling |

No state should tell the user they did something wrong when the system failed.

## 11. Visual System

The product should feel like an inspection bench: quiet, dense, and durable. Avoid marketing-page composition.

### Spacing

Use only:

```text
4, 8, 12, 16, 24, 32, 48, 64
```

### Type

| Token | Size | Weight | Use |
| --- | ---: | ---: | --- |
| `display` | 28 | 600 | Page title |
| `title` | 20 | 600 | Section heading |
| `body-strong` | 14 | 600 | Counts, tile state |
| `body` | 14 | 400 | Default text |
| `caption` | 12 | 400 | Helper text, timestamps |
| `mono` | 13 | 400 | Filenames, IDs, dimensions |

Do not scale type with viewport width. Use weight, contrast, and placement before size.

### Color

Use a small fixed inventory:

- 9 neutral steps from background to primary text.
- 1 accent hue for primary action and bounding boxes.
- 4 status pairs: `running`, `done`, `failed`, `attention`.

Do not rely on color alone. Status badges need shape or text.

### Bounding Boxes

- Stroke: `2px`.
- Color: accent.
- Label: inside top-left of the box when space allows.
- Confidence: hidden in v1 product UI unless a future analyzer provides calibrated scores.
- Box coordinates are stored in natural image pixels and scaled to displayed image size.

## 12. Debug Surface

Provider details do not belong in the normal product UI, but the prototype needs inspection tools.

Debug drawer fields:

- provider
- prompt version
- latency
- raw analyzer response
- normalized detections
- job id
- target image id

This drawer is local/prototype-only until there is a real support workflow.

## 13. Deliberately Not V1

These are good ideas, just not first.

- Low-confidence bucket.
- Threshold slider.
- Manual box drawing.
- PDF/report designer.
- Organization settings.
- Saved defect templates.
- Provider comparison UI.
- Admin observability dashboard.
- Model/provider management.

Each one should earn its place through usage, not optimism.

## 14. Acceptance Test

A new user, given the live URL and one sentence, `inspect these for the kind of defect in this reference image`, can:

1. Start a new inspection in one click.
2. Submit a reference, description, and targets without reading documentation.
3. Watch progress without refreshing.
4. Refresh the browser and return to the same job.
5. Open results and answer `did it find defects?` in under 5 seconds.
6. Mark an incorrect result wrong.
7. Retry a failed target without losing completed targets.
8. Find the same inspection later from the library.

If a step needs explanation, the design is wrong, not the user.

## 15. Implementation Order From Here

The current prototype already has upload, local job state, Gemini processing, progress polling, and basic results.

Next implementation steps:

1. Add the inspection library using `jobs/index.json`.
2. Add reopen behavior for completed/running jobs.
3. Split the prototype UI into library, new inspection, running, and review modes.
4. Add filters: `All`, `Defect`, `Clean`, `Failed`.
5. Add image detail with previous/next.
6. Add confirm/reject feedback persisted in job JSON.
7. Add retry target as a new attempt.

This order follows the real bottleneck: Sightline must first feel like a durable inspection workflow, not a one-shot demo.
