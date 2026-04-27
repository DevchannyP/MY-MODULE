'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { PostgresVideoRepository, PostgresTranscodeJobRepository } =
  require('../../src/infrastructure/PostgresVideoRepository');
const { Video }        = require('../../src/domain/Video');
const { TranscodeJob } = require('../../src/domain/TranscodeJob');

const NOW = new Date().toISOString();

// ── FakePgClient ──────────────────────────────────────────────────────────────

class FakePgClient {
  constructor() {
    this._videos = new Map();
    this._jobs   = new Map();
  }

  async query(sql, params = []) {
    const s = String(sql).replace(/\s+/g, ' ').trim();

    // video_contents
    if (/SELECT \* FROM public\.video_contents WHERE id=/.test(s)) {
      const row = this._videos.get(params[0]);
      return { rows: row ? [row] : [] };
    }
    if (/INSERT INTO public\.video_contents/.test(s)) {
      const [id, title, uploaderId, fileRef, status, policy, desc, dur, size, ca, ua] = params;
      this._videos.set(id, { id, title, uploader_id: uploaderId, original_file_ref: fileRef, status, access_policy: policy, description: desc, duration_seconds: dur, file_size_bytes: size, created_at: ca, updated_at: ua, version: 1 });
      return { rows: [], rowCount: 1 };
    }
    if (/COUNT\(\*\)::int AS cnt FROM public\.video_contents/.test(s)) {
      return { rows: [{ cnt: this._videos.size }] };
    }
    if (/SELECT \* FROM public\.video_contents/.test(s)) {
      return { rows: [...this._videos.values()] };
    }

    // video_transcode_jobs
    if (/SELECT \* FROM public\.video_transcode_jobs WHERE id=/.test(s)) {
      const row = this._jobs.get(params[0]);
      return { rows: row ? [row] : [] };
    }
    if (/SELECT \* FROM public\.video_transcode_jobs WHERE video_id=.* AND status='RUNNING'/.test(s)) {
      const found = [...this._jobs.values()].find((j) => j.video_id === params[0] && j.status === 'RUNNING');
      return { rows: found ? [found] : [] };
    }
    if (/SELECT id FROM public\.video_transcode_jobs WHERE video_id=.* AND status='RUNNING' AND id<>/.test(s)) {
      const found = [...this._jobs.values()].find((j) => j.video_id === params[0] && j.status === 'RUNNING' && j.id !== params[1]);
      return { rows: found ? [found] : [] };
    }
    if (/SELECT \* FROM public\.video_transcode_jobs WHERE video_id=/.test(s)) {
      const rows = [...this._jobs.values()].filter((j) => j.video_id === params[0]);
      return { rows };
    }
    if (/INSERT INTO public\.video_transcode_jobs/.test(s)) {
      const [id, videoId, status, fmt, res, outRef, prog, errMsg, ca, completedAt] = params;
      this._jobs.set(id, { id, video_id: videoId, status, target_format: fmt, target_resolution: res, output_rendition_ref: outRef, progress_percent: prog, error_message: errMsg, created_at: ca, completed_at: completedAt });
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('PostgresVideoRepository: client.query 없으면 TypeError', () => {
  assert.throws(() => new PostgresVideoRepository({ client: null }), TypeError);
});

test('PostgresVideoRepository: save → findById 왕복 (fake client)', async () => {
  const client = new FakePgClient();
  const repo   = new PostgresVideoRepository({ client });
  const video  = new Video({ videoId: 'vid-pg1', title: 'PG Test', uploaderId: 'u1', originalFileRef: 's3://x', status: 'UPLOADED', accessPolicy: 'PRIVATE', createdAt: NOW, updatedAt: NOW });
  await repo.save(video);
  const found = await repo.findById('vid-pg1');
  assert.ok(found);
  assert.equal(found.videoId,    'vid-pg1');
  assert.equal(found.uploaderId, 'u1');
  assert.equal(found.status,     'UPLOADED');
});

test('PostgresVideoRepository: findAll (fake client)', async () => {
  const client = new FakePgClient();
  const repo   = new PostgresVideoRepository({ client });
  await repo.save(new Video({ videoId: 'v1', title: 'A', uploaderId: 'u1', originalFileRef: 's3://a', status: 'UPLOADED', accessPolicy: 'PRIVATE', createdAt: NOW, updatedAt: NOW }));
  await repo.save(new Video({ videoId: 'v2', title: 'B', uploaderId: 'u1', originalFileRef: 's3://b', status: 'READY',    accessPolicy: 'PUBLIC',  createdAt: NOW, updatedAt: NOW }));
  const all = await repo.findAll();
  assert.equal(all.total, 2);
});

test('PostgresTranscodeJobRepository: save → findById (fake client)', async () => {
  const client = new FakePgClient();
  const repo   = new PostgresTranscodeJobRepository({ client });
  const job    = new TranscodeJob({ jobId: 'job-pg1', videoId: 'vid-x', status: 'PENDING', targetFormat: 'MP4', targetResolution: '1080p', createdAt: NOW });
  await repo.save(job);
  const found = await repo.findById('job-pg1');
  assert.ok(found);
  assert.equal(found.jobId,  'job-pg1');
  assert.equal(found.status, 'PENDING');
});

test('PostgresTranscodeJobRepository: INV-V004 — RUNNING 중복 불가 (fake client)', async () => {
  const client = new FakePgClient();
  const repo   = new PostgresTranscodeJobRepository({ client });
  const j1 = new TranscodeJob({ jobId: 'run-1', videoId: 'vid-y', status: 'RUNNING', targetFormat: 'MP4', targetResolution: '720p', createdAt: NOW });
  await repo.save(j1);
  const j2 = new TranscodeJob({ jobId: 'run-2', videoId: 'vid-y', status: 'RUNNING', targetFormat: 'HLS', targetResolution: '720p', createdAt: NOW });
  await assert.rejects(() => repo.save(j2), { code: 'CONFLICT' });
});

test('PostgresTranscodeJobRepository: findRunningByVideoId (fake client)', async () => {
  const client = new FakePgClient();
  const repo   = new PostgresTranscodeJobRepository({ client });
  const job    = new TranscodeJob({ jobId: 'run-3', videoId: 'vid-z', status: 'RUNNING', targetFormat: 'MP4', targetResolution: '1080p', createdAt: NOW });
  await repo.save(job);
  const found = await repo.findRunningByVideoId('vid-z');
  assert.ok(found);
  assert.equal(found.jobId, 'run-3');
  const none = await repo.findRunningByVideoId('vid-none');
  assert.equal(none, null);
});
