'use strict';

/**
 * VideoController authz 테스트
 * ADR-0002 패턴: 7개 엔드포인트 × 권한 없음 → 403
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { VideoController }                 = require('../../src/interface/VideoController');
const { InMemoryVideoRepository }         = require('../../src/infrastructure/InMemoryVideoRepository');
const { InMemoryTranscodeJobRepository }  = require('../../src/infrastructure/InMemoryTranscodeJobRepository');
const { Video }                           = require('../../src/domain/Video');
const { TranscodeJob }                    = require('../../src/domain/TranscodeJob');

const NO_PERM      = { permissions: [], userId: 'nobody' };
const READ_CALLER  = { permissions: ['video:read'],  userId: 'user-1' };
const WRITE_CALLER = { permissions: ['video:write'], userId: 'user-1' };

function makeCtrl(overrides = {}) {
  const videoRepository          = overrides.videoRepository          || new InMemoryVideoRepository();
  const transcodeJobRepository   = overrides.transcodeJobRepository   || new InMemoryTranscodeJobRepository();
  const ctrl = new VideoController({ videoRepository, transcodeJobRepository });
  return { ctrl, videoRepository, transcodeJobRepository };
}

async function seedVideo(repo, status = 'UPLOADED') {
  let v = Video.create({ videoId: 'vid-1', title: '제목', uploaderId: 'user-1', originalFileRef: 'ref', accessPolicy: 'PUBLIC' });
  if (status === 'PROCESSING' || status === 'READY') v = v.transitionTo('PROCESSING');
  if (status === 'READY') v = v.transitionTo('READY');
  await repo.save(v);
  return v;
}

async function seedJob(repo) {
  const job = TranscodeJob.create({ jobId: 'job-1', videoId: 'vid-1', targetFormat: 'MP4', targetResolution: '1080p' });
  await repo.save(job);
  return job;
}

// ── 1. POST /videos — uploadVideo ─────────────────────────────────────────────
describe('[VideoController authz] POST /videos', () => {
  test('권한 없음 → 403', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/videos',
      body: { title: '제목', original_file_ref: 'ref' },
      caller: NO_PERM,
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'FORBIDDEN');
  });

  test('video:read만 → 403', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/videos',
      body: { title: '제목', original_file_ref: 'ref' },
      caller: READ_CALLER,
    });
    assert.equal(res.status, 403);
  });
});

// ── 2. GET /videos — listVideos ───────────────────────────────────────────────
describe('[VideoController authz] GET /videos', () => {
  test('권한 없음 → 403', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({ method: 'GET', path: '/videos', caller: NO_PERM });
    assert.equal(res.status, 403);
  });

  test('video:write만 → 403', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({ method: 'GET', path: '/videos', caller: WRITE_CALLER });
    assert.equal(res.status, 403);
  });
});

// ── 3. GET /videos/:videoId — getVideo ────────────────────────────────────────
describe('[VideoController authz] GET /videos/:videoId', () => {
  test('권한 없음 → 403', async () => {
    const { ctrl, videoRepository } = makeCtrl();
    await seedVideo(videoRepository);
    const res = await ctrl.handle({
      method: 'GET', path: '/videos/:videoId',
      params: { videoId: 'vid-1' }, caller: NO_PERM,
    });
    assert.equal(res.status, 403);
  });
});

// ── 4. POST /videos/:videoId/transcode — startTranscodeJob ────────────────────
describe('[VideoController authz] POST /videos/:videoId/transcode', () => {
  test('권한 없음 → 403', async () => {
    const { ctrl, videoRepository } = makeCtrl();
    await seedVideo(videoRepository);
    const res = await ctrl.handle({
      method: 'POST', path: '/videos/:videoId/transcode',
      params: { videoId: 'vid-1' },
      body: { target_format: 'MP4', target_resolution: '1080p' },
      caller: NO_PERM,
    });
    assert.equal(res.status, 403);
  });

  test('video:read만 → 403', async () => {
    const { ctrl, videoRepository } = makeCtrl();
    await seedVideo(videoRepository);
    const res = await ctrl.handle({
      method: 'POST', path: '/videos/:videoId/transcode',
      params: { videoId: 'vid-1' },
      body: { target_format: 'MP4', target_resolution: '1080p' },
      caller: READ_CALLER,
    });
    assert.equal(res.status, 403);
  });
});

// ── 5. GET /videos/:videoId/transcode-jobs/:jobId — getTranscodeJob ───────────
describe('[VideoController authz] GET /videos/:videoId/transcode-jobs/:jobId', () => {
  test('권한 없음 → 403', async () => {
    const { ctrl, videoRepository, transcodeJobRepository } = makeCtrl();
    await seedVideo(videoRepository);
    await seedJob(transcodeJobRepository);
    const res = await ctrl.handle({
      method: 'GET', path: '/videos/:videoId/transcode-jobs/:jobId',
      params: { videoId: 'vid-1', jobId: 'job-1' },
      caller: NO_PERM,
    });
    assert.equal(res.status, 403);
  });
});

// ── 6. PATCH /videos/:videoId/access-policy — changeAccessPolicy ──────────────
describe('[VideoController authz] PATCH /videos/:videoId/access-policy', () => {
  test('권한 없음 → 403', async () => {
    const { ctrl, videoRepository } = makeCtrl();
    await seedVideo(videoRepository);
    const res = await ctrl.handle({
      method: 'PATCH', path: '/videos/:videoId/access-policy',
      params: { videoId: 'vid-1' }, body: { access_policy: 'PUBLIC' },
      caller: NO_PERM,
    });
    assert.equal(res.status, 403);
  });

  test('video:read만 → 403', async () => {
    const { ctrl, videoRepository } = makeCtrl();
    await seedVideo(videoRepository);
    const res = await ctrl.handle({
      method: 'PATCH', path: '/videos/:videoId/access-policy',
      params: { videoId: 'vid-1' }, body: { access_policy: 'PUBLIC' },
      caller: READ_CALLER,
    });
    assert.equal(res.status, 403);
  });
});

// ── 6b. PATCH changeAccessPolicy — 소유권 검사 (GAP-V002 회귀) ────────────────
describe('[VideoController authz] PATCH /videos/:videoId/access-policy 소유권', () => {
  test('[회귀] 비소유자 video:write → 403 (INV-V003 소유권 강제)', async () => {
    const { ctrl, videoRepository } = makeCtrl();
    // 영상 소유자: user-1
    const v = Video.create({ videoId: 'vid-1', title: '제목', uploaderId: 'user-1', originalFileRef: 'ref', accessPolicy: 'PRIVATE' });
    await videoRepository.save(v);
    // 비소유자 user-2가 변경 시도
    const res = await ctrl.handle({
      method: 'PATCH', path: '/videos/:videoId/access-policy',
      params: { videoId: 'vid-1' }, body: { access_policy: 'PUBLIC' },
      caller: { permissions: ['video:write'], userId: 'user-2' },
    });
    assert.equal(res.status, 403);
  });

  test('[회귀] video:admin은 타인 영상 정책 변경 가능 → 200', async () => {
    const { ctrl, videoRepository } = makeCtrl();
    const v = Video.create({ videoId: 'vid-1', title: '제목', uploaderId: 'user-1', originalFileRef: 'ref', accessPolicy: 'PRIVATE' });
    await videoRepository.save(v);
    const res = await ctrl.handle({
      method: 'PATCH', path: '/videos/:videoId/access-policy',
      params: { videoId: 'vid-1' }, body: { access_policy: 'PUBLIC' },
      caller: { permissions: ['video:write', 'video:admin'], userId: 'admin-1' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.access_policy, 'PUBLIC');
  });
});

// ── 7. POST /videos/:videoId/archive — archiveVideo ───────────────────────────
describe('[VideoController authz] POST /videos/:videoId/archive', () => {
  test('권한 없음 → 403', async () => {
    const { ctrl, videoRepository } = makeCtrl();
    await seedVideo(videoRepository, 'READY');
    const res = await ctrl.handle({
      method: 'POST', path: '/videos/:videoId/archive',
      params: { videoId: 'vid-1' }, caller: NO_PERM,
    });
    assert.equal(res.status, 403);
  });

  test('video:write만 → 403 (video:admin 필요)', async () => {
    const { ctrl, videoRepository } = makeCtrl();
    await seedVideo(videoRepository, 'READY');
    const res = await ctrl.handle({
      method: 'POST', path: '/videos/:videoId/archive',
      params: { videoId: 'vid-1' }, caller: WRITE_CALLER,
    });
    assert.equal(res.status, 403);
  });

  test('video:read만 → 403 (video:admin 필요)', async () => {
    const { ctrl, videoRepository } = makeCtrl();
    await seedVideo(videoRepository, 'READY');
    const res = await ctrl.handle({
      method: 'POST', path: '/videos/:videoId/archive',
      params: { videoId: 'vid-1' }, caller: READ_CALLER,
    });
    assert.equal(res.status, 403);
  });
});
