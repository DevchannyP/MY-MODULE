'use strict';

/**
 * VideoController smoke 테스트
 * 기본 경로 성공 케이스 + 404 케이스
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { VideoController }                 = require('../../src/interface/VideoController');
const { InMemoryVideoRepository }         = require('../../src/infrastructure/InMemoryVideoRepository');
const { InMemoryTranscodeJobRepository }  = require('../../src/infrastructure/InMemoryTranscodeJobRepository');
const { Video }                           = require('../../src/domain/Video');
const { TranscodeJob }                    = require('../../src/domain/TranscodeJob');

const READ_CALLER  = { permissions: ['video:read'],  userId: 'user-1' };
const WRITE_CALLER = { permissions: ['video:write'], userId: 'user-1' };
const ADMIN_CALLER = { permissions: ['video:admin'], userId: 'admin-1' };
const FULL_CALLER  = { permissions: ['video:read', 'video:write', 'video:admin'], userId: 'user-1' };

function makeCtrl() {
  const videoRepository          = new InMemoryVideoRepository();
  const transcodeJobRepository   = new InMemoryTranscodeJobRepository();
  const ctrl = new VideoController({ videoRepository, transcodeJobRepository });
  return { ctrl, videoRepository, transcodeJobRepository };
}

async function seedVideo(repo, status = 'UPLOADED', accessPolicy = 'PUBLIC') {
  let v = Video.create({ videoId: 'vid-1', title: '테스트 영상', uploaderId: 'user-1', originalFileRef: 's3://bucket/v.mp4', accessPolicy });
  if (status === 'PROCESSING' || status === 'READY') v = v.transitionTo('PROCESSING');
  if (status === 'READY') v = v.transitionTo('READY');
  await repo.save(v);
  return v;
}

// ── 알 수 없는 라우트 ─────────────────────────────────────────────────────────
describe('[VideoController smoke] 알 수 없는 라우트', () => {
  test('매핑되지 않은 경로 → 404', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({ method: 'DELETE', path: '/videos/unknown/action', caller: FULL_CALLER });
    assert.equal(res.status, 404);
  });

  test('404 응답에 code + message 필드 있음', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({ method: 'GET', path: '/unknown', caller: FULL_CALLER });
    assert.equal(res.status, 404);
    assert.ok(res.body.code);
    assert.ok(res.body.message);
  });
});

// ── POST /videos — uploadVideo ────────────────────────────────────────────────
describe('[VideoController smoke] POST /videos', () => {
  test('video:write → 201 + Video body', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/videos',
      body: { title: '내 영상', original_file_ref: 's3://bucket/v.mp4' },
      caller: WRITE_CALLER,
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.video_id);
    assert.equal(res.body.title, '내 영상');
    assert.equal(res.body.status, 'UPLOADED');
    assert.ok(res.body.created_at);
  });

  test('[회귀] file_size_bytes=0을 null로 바꾸지 않는다', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/videos',
      body: { title: '0 byte 영상', original_file_ref: 's3://bucket/v.mp4', file_size_bytes: 0 },
      caller: WRITE_CALLER,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.file_size_bytes, 0);
  });

  test('title 누락 → 400', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/videos',
      body: { original_file_ref: 'ref' },
      caller: WRITE_CALLER,
    });
    assert.equal(res.status, 400);
  });
});

// ── GET /videos — listVideos ──────────────────────────────────────────────────
describe('[VideoController smoke] GET /videos', () => {
  test('video:read → 200 + 목록 구조', async () => {
    const { ctrl, videoRepository } = makeCtrl();
    await seedVideo(videoRepository);
    const res = await ctrl.handle({ method: 'GET', path: '/videos', caller: READ_CALLER });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.items));
    assert.equal(res.body.items.length, 1);
    assert.equal(typeof res.body.total, 'number');
    assert.ok('video_id'          in res.body.items[0]);
    assert.ok('status'            in res.body.items[0]);
    assert.ok('access_policy'     in res.body.items[0]);
  });

  test('빈 목록 → 200 + 빈 배열', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({ method: 'GET', path: '/videos', caller: READ_CALLER });
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 0);
    assert.equal(res.body.total, 0);
  });
});

// ── GET /videos/:videoId — getVideo ───────────────────────────────────────────
describe('[VideoController smoke] GET /videos/:videoId', () => {
  test('존재하는 영상 → 200 + Video body', async () => {
    const { ctrl, videoRepository } = makeCtrl();
    await seedVideo(videoRepository);
    const res = await ctrl.handle({
      method: 'GET', path: '/videos/:videoId',
      params: { videoId: 'vid-1' }, caller: READ_CALLER,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.video_id, 'vid-1');
    assert.equal(res.body.title, '테스트 영상');
  });

  test('존재하지 않는 videoId → 404', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'GET', path: '/videos/:videoId',
      params: { videoId: 'nonexistent' }, caller: READ_CALLER,
    });
    assert.equal(res.status, 404);
    assert.ok(res.body.code);
    assert.ok(res.body.message);
  });
});

// ── POST /videos/:videoId/transcode — startTranscodeJob ───────────────────────
describe('[VideoController smoke] POST /videos/:videoId/transcode', () => {
  test('video:write + Video 존재 → 201 + TranscodeJob body', async () => {
    const { ctrl, videoRepository } = makeCtrl();
    await seedVideo(videoRepository);
    const res = await ctrl.handle({
      method: 'POST', path: '/videos/:videoId/transcode',
      params: { videoId: 'vid-1' },
      body: { target_format: 'MP4', target_resolution: '1080p' },
      caller: WRITE_CALLER,
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.job_id);
    assert.equal(res.body.video_id, 'vid-1');
    assert.equal(res.body.status, 'PENDING');
  });

  test('존재하지 않는 videoId → 404', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/videos/:videoId/transcode',
      params: { videoId: 'nonexistent' },
      body: { target_format: 'MP4', target_resolution: '1080p' },
      caller: WRITE_CALLER,
    });
    assert.equal(res.status, 404);
  });

  test('이미 RUNNING Job 존재 → 409 (INV-V004)', async () => {
    const { ctrl, videoRepository, transcodeJobRepository } = makeCtrl();
    await seedVideo(videoRepository);
    const job = TranscodeJob.create({ jobId: 'job-x', videoId: 'vid-1', targetFormat: 'MP4', targetResolution: '720p' });
    await transcodeJobRepository.save(job.transitionTo('RUNNING'));

    const res = await ctrl.handle({
      method: 'POST', path: '/videos/:videoId/transcode',
      params: { videoId: 'vid-1' },
      body: { target_format: 'HLS', target_resolution: '1080p' },
      caller: WRITE_CALLER,
    });
    assert.equal(res.status, 409);
  });
});

// ── GET /videos/:videoId/transcode-jobs/:jobId — getTranscodeJob ──────────────
describe('[VideoController smoke] GET /videos/:videoId/transcode-jobs/:jobId', () => {
  test('존재하는 Job → 200 + TranscodeJob body', async () => {
    const { ctrl, videoRepository, transcodeJobRepository } = makeCtrl();
    await seedVideo(videoRepository);
    const job = TranscodeJob.create({ jobId: 'job-1', videoId: 'vid-1', targetFormat: 'MP4', targetResolution: '1080p' });
    await transcodeJobRepository.save(job);

    const res = await ctrl.handle({
      method: 'GET', path: '/videos/:videoId/transcode-jobs/:jobId',
      params: { videoId: 'vid-1', jobId: 'job-1' }, caller: READ_CALLER,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.job_id, 'job-1');
    assert.equal(res.body.status, 'PENDING');
  });

  test('존재하지 않는 jobId → 404', async () => {
    const { ctrl, videoRepository } = makeCtrl();
    await seedVideo(videoRepository);
    const res = await ctrl.handle({
      method: 'GET', path: '/videos/:videoId/transcode-jobs/:jobId',
      params: { videoId: 'vid-1', jobId: 'nonexistent' }, caller: READ_CALLER,
    });
    assert.equal(res.status, 404);
  });
});

// ── PATCH /videos/:videoId/access-policy — changeAccessPolicy ─────────────────
describe('[VideoController smoke] PATCH /videos/:videoId/access-policy', () => {
  test('video:write → 200 + 변경된 Video body', async () => {
    const { ctrl, videoRepository } = makeCtrl();
    await seedVideo(videoRepository, 'UPLOADED', 'PRIVATE');
    const res = await ctrl.handle({
      method: 'PATCH', path: '/videos/:videoId/access-policy',
      params: { videoId: 'vid-1' }, body: { access_policy: 'PUBLIC' },
      caller: WRITE_CALLER,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.access_policy, 'PUBLIC');
  });
});

// ── POST /videos/:videoId/archive — archiveVideo ──────────────────────────────
describe('[VideoController smoke] POST /videos/:videoId/archive', () => {
  test('video:admin + READY 상태 → 200 + ARCHIVED Video', async () => {
    const { ctrl, videoRepository } = makeCtrl();
    await seedVideo(videoRepository, 'READY');
    const res = await ctrl.handle({
      method: 'POST', path: '/videos/:videoId/archive',
      params: { videoId: 'vid-1' }, caller: ADMIN_CALLER,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ARCHIVED');
  });

  test('UPLOADED 상태 아카이브 시도 → 409 (INV-V002)', async () => {
    const { ctrl, videoRepository } = makeCtrl();
    await seedVideo(videoRepository, 'UPLOADED');
    const res = await ctrl.handle({
      method: 'POST', path: '/videos/:videoId/archive',
      params: { videoId: 'vid-1' }, caller: ADMIN_CALLER,
    });
    assert.equal(res.status, 409);
  });

  test('존재하지 않는 videoId → 404', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/videos/:videoId/archive',
      params: { videoId: 'nonexistent' }, caller: ADMIN_CALLER,
    });
    assert.equal(res.status, 404);
  });
});

// ── 오류 응답 구조 검증 ───────────────────────────────────────────────────────
describe('[VideoController smoke] 오류 응답 구조', () => {
  test('403 응답에 code + message 필드 있음', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({ method: 'GET', path: '/videos', caller: { permissions: [], userId: 'x' } });
    assert.equal(res.status, 403);
    assert.ok(res.body.code);
    assert.ok(res.body.message);
  });

  test('correlationId가 오류 응답에 포함됨', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'GET', path: '/videos',
      caller: { permissions: [], userId: 'x' },
      correlationId: 'corr-video-123',
    });
    assert.equal(res.body.correlation_id, 'corr-video-123');
  });
});
