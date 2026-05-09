# Roadmap

The next improvements should be driven by the current bottleneck: the real analyzer contract.

## 1. Analyzer Contract And Spike

Run a small real-analyzer test with one reference, one description, and five targets. Record latency, rate limits, batch support, webhook support, output schema, error shape, retry behavior, and privacy terms.

## 2. Reliability Hardening

Add stronger duplicate-result handling, stuck-job reconciliation, analyzer-request tracking, and an outbox publisher if queue publication needs stricter guarantees.

## 3. Operational Dashboard

Track upload failures, queue depth, attempt wait time, analyzer latency p50/p95/p99, analyzer error rate, retry count, partial failure rate, and job completion time.

## 4. Realtime Progress

Polling is enough for MVP. If progress needs to feel live, add SSE, Trigger.dev realtime, or another one-way update path before considering custom WebSockets.

## 5. Security, Retention, And Compliance

Define retention periods, permanent deletion behavior, tenant isolation, signed URL lifetime, and whether the external analyzer stores or trains on customer images.

## 6. Product Review Tools

Add manual box correction, false positive and false negative reasons, project or collection organization, exports, and report generation once the core workflow is stable.

## 7. Scale And Cost Controls

Add measured concurrency limits, per-user or per-tenant quotas, thumbnail generation, batch analyzer support if available, and load tests for 1, 10, and 100 simultaneous inspections.
