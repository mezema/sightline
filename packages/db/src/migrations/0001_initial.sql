create extension if not exists pgcrypto;

create type inspection_status as enum ('draft', 'uploading', 'queued', 'processing', 'completed', 'partially_failed', 'failed', 'cancelled');
create type image_asset_kind as enum ('reference', 'target', 'annotated_result');
create type upload_status as enum ('pending', 'uploaded', 'verified', 'failed');
create type attempt_status as enum ('pending', 'queued', 'running', 'succeeded', 'failed', 'cancelled');
create type coordinate_system as enum ('pixel');
create type feedback_subject_type as enum ('target', 'result', 'detection');
create type feedback_verdict as enum ('correct', 'wrong');
create type feedback_reason as enum ('false_positive', 'false_negative', 'wrong_location', 'wrong_label', 'other');
create type job_event_kind as enum ('inspection_created', 'uploads_verified', 'inspection_submitted', 'attempt_started', 'attempt_succeeded', 'attempt_failed', 'feedback_created', 'target_retried', 'inspection_cancelled');
create type outbox_status as enum ('pending', 'published', 'failed');

create table users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  email text not null unique,
  created_at timestamptz not null default now()
);

create table inspections (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references users(id) on delete cascade,
  defect_spec_id uuid,
  status inspection_status not null default 'draft',
  target_count integer not null default 0 check (target_count between 0 and 25),
  processed_count integer not null default 0 check (processed_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  defect_count integer not null default 0 check (defect_count >= 0),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz
);

create table image_assets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references users(id) on delete cascade,
  inspection_id uuid not null references inspections(id) on delete cascade,
  kind image_asset_kind not null,
  storage_key text not null unique,
  original_filename text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0),
  width integer check (width > 0),
  height integer check (height > 0),
  content_hash text,
  upload_status upload_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table defect_specs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references users(id) on delete cascade,
  inspection_id uuid not null unique references inspections(id) on delete cascade,
  reference_image_id uuid not null references image_assets(id),
  description text not null,
  created_at timestamptz not null default now()
);

alter table inspections add constraint inspections_defect_spec_id_fkey foreign key (defect_spec_id) references defect_specs(id);

create table inspection_targets (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspections(id) on delete cascade,
  target_image_id uuid not null references image_assets(id),
  position integer not null check (position >= 0),
  latest_attempt_id uuid,
  latest_result_id uuid,
  created_at timestamptz not null default now(),
  unique (inspection_id, position),
  unique (inspection_id, target_image_id)
);

create table processing_attempts (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspections(id) on delete cascade,
  inspection_target_id uuid not null references inspection_targets(id) on delete cascade,
  status attempt_status not null default 'pending',
  attempt integer not null check (attempt > 0),
  idempotency_key text not null unique,
  analyzer_request_id text,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  unique (inspection_target_id, attempt)
);

alter table inspection_targets add constraint inspection_targets_latest_attempt_id_fkey foreign key (latest_attempt_id) references processing_attempts(id);

create table inspection_results (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspections(id) on delete cascade,
  inspection_target_id uuid not null references inspection_targets(id) on delete cascade,
  attempt_id uuid not null unique references processing_attempts(id) on delete cascade,
  defect_found boolean not null,
  raw_analyzer_response jsonb not null,
  analyzer_provider text not null,
  analyzer_version text,
  result_schema_version integer not null,
  created_at timestamptz not null default now()
);

alter table inspection_targets add constraint inspection_targets_latest_result_id_fkey foreign key (latest_result_id) references inspection_results(id);

create table detections (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspections(id) on delete cascade,
  inspection_target_id uuid not null references inspection_targets(id) on delete cascade,
  result_id uuid not null references inspection_results(id) on delete cascade,
  label text not null,
  confidence double precision check (confidence is null or (confidence >= 0 and confidence <= 1)),
  x1 double precision not null,
  y1 double precision not null,
  x2 double precision not null,
  y2 double precision not null,
  coordinate_system coordinate_system not null default 'pixel',
  reason text,
  created_at timestamptz not null default now(),
  check (x2 >= x1),
  check (y2 >= y1)
);

create table feedback (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspections(id) on delete cascade,
  inspection_target_id uuid not null references inspection_targets(id) on delete cascade,
  subject_type feedback_subject_type not null,
  subject_id uuid,
  verdict feedback_verdict not null,
  reason feedback_reason,
  note text,
  created_by_user_id uuid not null references users(id),
  created_at timestamptz not null default now()
);

create table inspection_events (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspections(id) on delete cascade,
  actor_user_id uuid references users(id),
  kind job_event_kind not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table outbox_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null,
  status outbox_status not null default 'pending',
  created_at timestamptz not null default now(),
  published_at timestamptz
);
