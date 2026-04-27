//@ts-check
'use strict';

/**
 * SQLiteVideoRepository + SQLiteTranscodeJobRepository
 *
 * Video, TranscodeJob 두 포트를 공유 DB 연결로 운영한다.
 * Migration strategy: docs/db/migration-strategy.md Phase 1 (SQLite)
 */

const path = require('node:path');
const fs   = require('node:fs');

const { Video }        = require('../domain/Video');
const { TranscodeJob } = require('../domain/TranscodeJob');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql');

function openDb(dbPath) {
  if (!DatabaseSync) {
    throw new Error('node:sqlite을 사용할 수 없습니다. Node.js 22.5+ 가 필요합니다.');
  }
  const db = new DatabaseSync(dbPath);
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  return db;
}

// ── SQLiteVideoRepository ─────────────────────────────────────────────────────

class SQLiteVideoRepository {
  /** @param {object} db */
  constructor(db) { this._db = db; }

  static create(dbPath = ':memory:') {
    return new SQLiteVideoRepository(openDb(dbPath));
  }

  _rowToVideo(row) {
    return new Video({
      videoId:         row.id,
      title:           row.title,
      uploaderId:      row.uploader_id,
      originalFileRef: row.original_file_ref,
      status:          row.status,
      accessPolicy:    row.access_policy,
      description:     row.description || null,
      durationSeconds: row.duration_seconds ?? null,
      fileSizeBytes:   row.file_size_bytes ?? null,
      createdAt:       row.created_at,
      updatedAt:       row.updated_at,
    });
  }

  async findById(videoId) {
    const row = this._db.prepare('SELECT * FROM video_contents WHERE id=?').get(videoId);
    return row ? this._rowToVideo(row) : null;
  }

  async findAll({ status, uploaderId, page = 1, pageSize = 20 } = {}) {
    const conditions = [];
    const params = [];
    if (status)     { conditions.push('status=?');      params.push(status); }
    if (uploaderId) { conditions.push('uploader_id=?'); params.push(uploaderId); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const total = this._db.prepare(`SELECT COUNT(*) AS cnt FROM video_contents ${where}`).get(...params).cnt;
    const offset = (page - 1) * pageSize;
    const rows = this._db.prepare(
      `SELECT * FROM video_contents ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ).all(...params, pageSize, offset);
    return { items: rows.map((r) => this._rowToVideo(r)), total, page, page_size: pageSize };
  }

  async save(video) {
    this._db.prepare(`
      INSERT INTO video_contents
        (id,title,uploader_id,original_file_ref,status,access_policy,
         description,duration_seconds,file_size_bytes,created_at,updated_at,version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,1)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, status=excluded.status, access_policy=excluded.access_policy,
        description=excluded.description, duration_seconds=excluded.duration_seconds,
        file_size_bytes=excluded.file_size_bytes, updated_at=excluded.updated_at,
        version=version+1
    `).run(
      video.videoId, video.title, video.uploaderId, video.originalFileRef,
      video.status, video.accessPolicy,
      video.description || null, video.durationSeconds ?? null, video.fileSizeBytes ?? null,
      video.createdAt, video.updatedAt,
    );
    return video;
  }
}

// ── SQLiteTranscodeJobRepository ──────────────────────────────────────────────

class SQLiteTranscodeJobRepository {
  constructor(db) { this._db = db; }

  static create(dbPath = ':memory:') {
    return new SQLiteTranscodeJobRepository(openDb(dbPath));
  }

  _rowToJob(row) {
    return new TranscodeJob({
      jobId:              row.id,
      videoId:            row.video_id,
      status:             row.status,
      targetFormat:       row.target_format,
      targetResolution:   row.target_resolution,
      outputRenditionRef: row.output_rendition_ref || null,
      progressPercent:    row.progress_percent ?? null,
      errorMessage:       row.error_message || null,
      createdAt:          row.created_at,
      completedAt:        row.completed_at || null,
    });
  }

  async findById(jobId) {
    const row = this._db.prepare('SELECT * FROM video_transcode_jobs WHERE id=?').get(jobId);
    return row ? this._rowToJob(row) : null;
  }

  async findRunningByVideoId(videoId) {
    const row = this._db.prepare(
      "SELECT * FROM video_transcode_jobs WHERE video_id=? AND status='RUNNING' LIMIT 1",
    ).get(videoId);
    return row ? this._rowToJob(row) : null;
  }

  async findAllByVideoId(videoId) {
    const rows = this._db.prepare(
      'SELECT * FROM video_transcode_jobs WHERE video_id=? ORDER BY created_at DESC',
    ).all(videoId);
    return rows.map((r) => this._rowToJob(r));
  }

  async save(job) {
    // INV-V004: Video당 RUNNING Job은 하나만 (Repository 계층 검사)
    if (job.status === 'RUNNING') {
      const existing = this._db.prepare(
        "SELECT id FROM video_transcode_jobs WHERE video_id=? AND status='RUNNING' AND id!=?",
      ).get(job.videoId, job.jobId);
      if (existing) {
        throw Object.assign(
          new Error(`INV-V004: video ${job.videoId}에 이미 RUNNING Job이 존재한다`),
          { code: 'CONFLICT' },
        );
      }
    }
    this._db.prepare(`
      INSERT INTO video_transcode_jobs
        (id,video_id,status,target_format,target_resolution,
         output_rendition_ref,progress_percent,error_message,created_at,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        status=excluded.status, output_rendition_ref=excluded.output_rendition_ref,
        progress_percent=excluded.progress_percent, error_message=excluded.error_message,
        completed_at=excluded.completed_at
    `).run(
      job.jobId, job.videoId, job.status,
      job.targetFormat, job.targetResolution,
      job.outputRenditionRef || null, job.progressPercent ?? null,
      job.errorMessage || null, job.createdAt,
      job.completedAt || null,
    );
    return job;
  }
}

module.exports = { SQLiteVideoRepository, SQLiteTranscodeJobRepository };
