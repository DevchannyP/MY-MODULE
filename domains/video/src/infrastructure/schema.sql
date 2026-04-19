-- Video Domain — SQLite Schema
-- Benchmark: Hexagonal Architecture (Cockburn), Flyway migration conventions
-- Version: 001 — initial

CREATE TABLE IF NOT EXISTS video_contents (
  id                  TEXT    NOT NULL PRIMARY KEY,  -- video-{timestamp}-{counter}
  title               TEXT    NOT NULL,
  uploader_id         TEXT    NOT NULL,
  original_file_ref   TEXT    NOT NULL,
  status              TEXT    NOT NULL DEFAULT 'UPLOADED',
  access_policy       TEXT    NOT NULL DEFAULT 'PRIVATE',
  description         TEXT    NULL,
  duration_seconds    INTEGER NULL,
  file_size_bytes     INTEGER NULL,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  version             INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_video_contents_uploader ON video_contents(uploader_id);
CREATE INDEX IF NOT EXISTS idx_video_contents_status   ON video_contents(status);

CREATE TABLE IF NOT EXISTS video_transcode_jobs (
  id                    TEXT    NOT NULL PRIMARY KEY,
  video_id              TEXT    NOT NULL,
  status                TEXT    NOT NULL DEFAULT 'PENDING',
  target_format         TEXT    NOT NULL,
  target_resolution     TEXT    NOT NULL,
  output_rendition_ref  TEXT    NULL,
  progress_percent      INTEGER NULL,
  error_message         TEXT    NULL,
  created_at            TEXT    NOT NULL,
  completed_at          TEXT    NULL,
  FOREIGN KEY (video_id) REFERENCES video_contents(id)
);

CREATE INDEX IF NOT EXISTS idx_transcode_jobs_video  ON video_transcode_jobs(video_id);
CREATE INDEX IF NOT EXISTS idx_transcode_jobs_status ON video_transcode_jobs(status);

-- Domain event outbox (Transactional Outbox Pattern)
CREATE TABLE IF NOT EXISTS video_outbox (
  id           TEXT    NOT NULL PRIMARY KEY,
  event_type   TEXT    NOT NULL,
  aggregate_id TEXT    NOT NULL,
  payload      TEXT    NOT NULL,
  created_at   TEXT    NOT NULL,
  delivered    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_video_outbox_pending ON video_outbox(delivered, created_at)
  WHERE delivered = 0;
