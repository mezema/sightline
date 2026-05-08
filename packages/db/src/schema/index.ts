import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const inspectionStatus = pgEnum("inspection_status", [
  "draft",
  "uploading",
  "queued",
  "processing",
  "completed",
  "partially_failed",
  "failed",
  "cancelled",
]);

export const imageAssetKind = pgEnum("image_asset_kind", ["reference", "target", "annotated_result"]);
export const uploadStatus = pgEnum("upload_status", ["pending", "uploaded", "verified", "failed"]);
export const attemptStatus = pgEnum("attempt_status", ["pending", "queued", "running", "succeeded", "failed", "cancelled"]);
export const coordinateSystem = pgEnum("coordinate_system", ["pixel"]);
export const feedbackSubjectType = pgEnum("feedback_subject_type", ["target", "result", "detection"]);
export const feedbackVerdict = pgEnum("feedback_verdict", ["correct", "wrong"]);
export const feedbackReason = pgEnum("feedback_reason", ["false_positive", "false_negative", "wrong_location", "wrong_label", "other"]);
export const jobEventKind = pgEnum("job_event_kind", [
  "inspection_created",
  "uploads_verified",
  "inspection_submitted",
  "attempt_started",
  "attempt_succeeded",
  "attempt_failed",
  "feedback_created",
  "target_retried",
  "inspection_cancelled",
]);
export const outboxStatus = pgEnum("outbox_status", ["pending", "published", "failed"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inspections = pgTable(
  "inspections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    defectSpecId: uuid("defect_spec_id"),
    status: inspectionStatus("status").notNull().default("draft"),
    targetCount: integer("target_count").notNull().default(0),
    processedCount: integer("processed_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    defectCount: integer("defect_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => ({
    targetLimit: check("inspections_target_count_limit", sql`${table.targetCount} >= 0 and ${table.targetCount} <= 25`),
  }),
);

export const imageAssets = pgTable("image_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  inspectionId: uuid("inspection_id").notNull().references(() => inspections.id, { onDelete: "cascade" }),
  kind: imageAssetKind("kind").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  originalFilename: text("original_filename").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  width: integer("width"),
  height: integer("height"),
  contentHash: text("content_hash"),
  uploadStatus: uploadStatus("upload_status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const defectSpecs = pgTable("defect_specs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  inspectionId: uuid("inspection_id").notNull().unique().references(() => inspections.id, { onDelete: "cascade" }),
  referenceImageId: uuid("reference_image_id").notNull().references(() => imageAssets.id),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inspectionTargets = pgTable(
  "inspection_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inspectionId: uuid("inspection_id").notNull().references(() => inspections.id, { onDelete: "cascade" }),
    targetImageId: uuid("target_image_id").notNull().references(() => imageAssets.id),
    position: integer("position").notNull(),
    latestAttemptId: uuid("latest_attempt_id"),
    latestResultId: uuid("latest_result_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    positionUnique: unique("inspection_targets_inspection_position_unique").on(table.inspectionId, table.position),
    targetUnique: unique("inspection_targets_inspection_target_image_unique").on(table.inspectionId, table.targetImageId),
  }),
);

export const processingAttempts = pgTable(
  "processing_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inspectionId: uuid("inspection_id").notNull().references(() => inspections.id, { onDelete: "cascade" }),
    inspectionTargetId: uuid("inspection_target_id").notNull().references(() => inspectionTargets.id, { onDelete: "cascade" }),
    status: attemptStatus("status").notNull().default("pending"),
    attempt: integer("attempt").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    analyzerRequestId: text("analyzer_request_id"),
    lastError: text("last_error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    attemptUnique: unique("processing_attempts_target_attempt_unique").on(table.inspectionTargetId, table.attempt),
  }),
);

export const inspectionResults = pgTable("inspection_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  inspectionId: uuid("inspection_id").notNull().references(() => inspections.id, { onDelete: "cascade" }),
  inspectionTargetId: uuid("inspection_target_id").notNull().references(() => inspectionTargets.id, { onDelete: "cascade" }),
  attemptId: uuid("attempt_id").notNull().unique().references(() => processingAttempts.id, { onDelete: "cascade" }),
  defectFound: boolean("defect_found").notNull(),
  rawAnalyzerResponse: jsonb("raw_analyzer_response").notNull(),
  analyzerProvider: text("analyzer_provider").notNull(),
  analyzerVersion: text("analyzer_version"),
  resultSchemaVersion: integer("result_schema_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const detections = pgTable(
  "detections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inspectionId: uuid("inspection_id").notNull().references(() => inspections.id, { onDelete: "cascade" }),
    inspectionTargetId: uuid("inspection_target_id").notNull().references(() => inspectionTargets.id, { onDelete: "cascade" }),
    resultId: uuid("result_id").notNull().references(() => inspectionResults.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    confidence: doublePrecision("confidence"),
    x1: doublePrecision("x1").notNull(),
    y1: doublePrecision("y1").notNull(),
    x2: doublePrecision("x2").notNull(),
    y2: doublePrecision("y2").notNull(),
    coordinateSystem: coordinateSystem("coordinate_system").notNull().default("pixel"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    boxOrder: check("detections_box_order", sql`${table.x2} >= ${table.x1} and ${table.y2} >= ${table.y1}`),
  }),
);

export const feedback = pgTable("feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  inspectionId: uuid("inspection_id").notNull().references(() => inspections.id, { onDelete: "cascade" }),
  inspectionTargetId: uuid("inspection_target_id").notNull().references(() => inspectionTargets.id, { onDelete: "cascade" }),
  subjectType: feedbackSubjectType("subject_type").notNull(),
  subjectId: uuid("subject_id"),
  verdict: feedbackVerdict("verdict").notNull(),
  reason: feedbackReason("reason"),
  note: text("note"),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inspectionEvents = pgTable("inspection_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  inspectionId: uuid("inspection_id").notNull().references(() => inspections.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  kind: jobEventKind("kind").notNull(),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const outboxEvents = pgTable("outbox_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  status: outboxStatus("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

export const inspectionRelations = relations(inspections, ({ one, many }) => ({
  owner: one(users, { fields: [inspections.ownerUserId], references: [users.id] }),
  defectSpec: one(defectSpecs, { fields: [inspections.defectSpecId], references: [defectSpecs.id] }),
  targets: many(inspectionTargets),
}));
