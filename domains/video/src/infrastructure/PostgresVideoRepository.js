//@ts-check
'use strict';

/**
 * PostgresVideoRepository — Phase 2 어댑터 스캐폴딩
 *
 * VideoRepository, TranscodeJobRepository 두 포트를 pg 클라이언트 주입으로 구현한다.
 *
 * 주입 계약:
 *   client.query(sql, params) -> Promise<{ rows?: any[], rowCount?: number }>
 *
 * 전환 조건: docs/db/migration-strategy.md Phase 2
 * SQLite 동등 구현: SQLiteVideoRepository.js
 */

const { Video }        = require('../domain/Video');
const { TranscodeJob } = require('../domain/TranscodeJob');

// ── PostgresVideoRepository ───────────────────────────────────────────────────

class PostgresVideoRepository {
  /**
   * @param {{ client: { query: Function }, schema?: string }} deps
   */
  constructor({ client, schema = 'public' }) {
    if (!client || typeof client.query !== 'function') {
      throw new TypeError('PostgresVideoRepository: client.query 주입 필요');
    }
    this._client = client;
    this._tbl    = `${schema}.video_contents`;
  }

  async findById(videoId) {
    const res = await this._client.query(`SELECT * FROM ${this._tbl} WHERE id=$1`, [videoId]);
    const row = res?.rows?.[0];
    return row ? this._rowToVideo(row) : null;
  }

  async findAll({ status, uploaderId, page = 1, pageSize = 20 } = {}) {
    const where = []; const params = []; let idx = 1;
    if (status)     { where.push(`status=$${idx++}`);      params.push(status); }
    if (uploaderId) { where.push(`uploader_id=$${idx++}`); params.push(uploaderId); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const cntRes   = await this._client.query(`SELECT COUNT(*)::int AS cnt FROM ${this._tbl} ${whereSql}`, params);
    const total    = Number(cntRes?.rows?.[0]?.cnt || 0);
    const offset   = (page - 1) * pageSize;
    const listRes  = await this._client.query(
      `SELECT * FROM ${this._tbl} ${whereSql} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, pageSize, offset],
    );
    return { items: (listRes?.rows || []).map((r) => this._rowToVideo(r)), total, page, page_size: pageSize };
  }

  async save(video) {
    await this._client.query(
      `INSERT INTO ${this._tbl}
         (id,title,uploader_id,original_file_ref,status,access_policy,
          description,duration_seconds,file_size_bytes,created_at,updated_at,version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1)
       ON CONFLICT(id) DO UPDATE SET
         title=EXCLUDED.title, status=EXCLUDED.status, access_policy=EXCLUDED.access_policy,
         description=EXCLUDED.description, duration_seconds=EXCLUDED.duration_seconds,
         file_size_bytes=EXCLUDED.file_size_bytes, updated_at=EXCLUDED.updated_at,
         version=${this._tbl}.version+1`,
      [video.videoId, video.title, video.uploaderId, video.originalFileRef,
       video.status, video.accessPolicy,
       video.description    || null,
       video.durationSeconds ?? null,
       video.fileSizeBytes   ?? null,
       video.createdAt, video.updatedAt],
    );
    return video;
  }

  _rowToVideo(row) {
    return new Video({
      videoId:         row.id,
      title:           row.title,
      uploaderId:      row.uploader_id,
      originalFileRef: row.original_file_ref,
      status:          row.status,
      accessPolicy:    row.access_policy,
      description:     row.description     || null,
      durationSeconds: row.duration_seconds ?? null,
      fileSizeBytes:   row.file_size_bytes  ?? null,
      createdAt:       row.created_at,
      updatedAt:       row.updated_at,
    });
  }
}

// ── PostgresTranscodeJobRepository ───────────────────────────────────────────

class PostgresTranscodeJobRepository {
  constructor({ client, schema = 'public' }) {
    if (!client || typeof client.query !== 'function') {
      throw new TypeError('PostgresTranscodeJobRepository: client.query 주입 필요');
    }
    this._client = client;
    this._tbl    = `${schema}.video_transcode_jobs`;
  }

  async findById(jobId) {
    const res = await this._client.query(`SELECT * FROM ${this._tbl} WHERE id=$1`, [jobId]);
    const row = res?.rows?.[0];
    return row ? this._rowToJob(row) : null;
  }

  async findRunningByVideoId(videoId) {
    const res = await this._client.query(
      `SELECT * FROM ${this._tbl} WHERE video_id=$1 AND status='RUNNING' LIMIT 1`,
      [videoId],
    );
    const row = res?.rows?.[0];
    return row ? this._rowToJob(row) : null;
  }

  async findAllByVideoId(videoId) {
    const res = await this._client.query(
      `SELECT * FROM ${this._tbl} WHERE video_id=$1 ORDER BY created_at DESC`,
      [videoId],
    );
    return (res?.rows || []).map((r) => this._rowToJob(r));
  }

  async save(job) {
    // INV-V004: Video당 RUNNING Job은 하나만
    if (job.status === 'RUNNING') {
      const existing = await this._client.query(
        `SELECT id FROM ${this._tbl} WHERE video_id=$1 AND status='RUNNING' AND id<>$2`,
        [job.videoId, job.jobId],
      );
      if (existing?.rows?.length) {
        throw Object.assign(
          new Error(`INV-V004: video ${job.videoId}에 이미 RUNNING Job이 존재한다`),
          { code: 'CONFLICT' },
        );
      }
    }
    await this._client.query(
      `INSERT INTO ${this._tbl}
         (id,video_id,status,target_format,target_resolution,
          output_rendition_ref,progress_percent,error_message,created_at,completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT(id) DO UPDATE SET
         status=EXCLUDED.status,
         output_rendition_ref=EXCLUDED.output_rendition_ref,
         progress_percent=EXCLUDED.progress_percent,
         error_message=EXCLUDED.error_message,
         completed_at=EXCLUDED.completed_at`,
      [job.jobId, job.videoId, job.status,
       job.targetFormat, job.targetResolution,
       job.outputRenditionRef || null,
       job.progressPercent    ?? null,
       job.errorMessage       || null,
       job.createdAt, job.completedAt || null],
    );
    return job;
  }

  _rowToJob(row) {
    return new TranscodeJob({
      jobId:              row.id,
      videoId:            row.video_id,
      status:             row.status,
      targetFormat:       row.target_format,
      targetResolution:   row.target_resolution,
      outputRenditionRef: row.output_rendition_ref || null,
      progressPercent:    row.progress_percent     ?? null,
      errorMessage:       row.error_message        || null,
      createdAt:          row.created_at,
      completedAt:        row.completed_at         || null,
    });
  }
}

module.exports = { PostgresVideoRepository, PostgresTranscodeJobRepository };
