# Analyzer Contract

These are the most important unknowns before treating Sightline as production-ready with a real analyzer.

| Requirement | Owner | Status |
| --- | --- | --- |
| Confirm whether analysis is one target per request or batch-based. | External analyzer owner | Still needed |
| Confirm latency p50/p95 and rate limits. | External analyzer owner | Still needed |
| Confirm whether webhooks are available. | External analyzer owner | Still needed |
| Confirm output schema: defect flag, confidence, boxes, masks, annotated image, errors. | External analyzer owner | Partly built around boxes |
| Confirm bounding-box coordinate system. | External analyzer owner | Built for Gemini normalized boxes |
| Confirm privacy terms for uploaded images. | Product + Compliance | Still needed |
| Confirm idempotency and retry semantics. | External analyzer owner + Engineering | Still needed |

## Spike To Close The Contract

Run a small real-analyzer test with one reference image, one description, and five targets.

Record:

- Request shape: one target per request or batch.
- Latency: p50, p95, and timeout behavior.
- Rate limits and concurrency limits.
- Webhook availability.
- Output schema: defect flag, confidence, boxes, masks, annotated image, errors.
- Bounding-box coordinate system.
- Error shape and retry behavior.
- Idempotency support.
- Privacy terms for uploaded images.

The analyzer is behind the `DefectAnalyzer` port. Provider-specific response formats should stay inside adapters and should not reach the UI.
