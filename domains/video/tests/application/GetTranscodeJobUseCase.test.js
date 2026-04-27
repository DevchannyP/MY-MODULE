'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { GetTranscodeJobUseCase }           = require('../../src/application/GetTranscodeJobUseCase');
const { InMemoryVideoRepository }          = require('../../src/infrastructure/InMemoryVideoRepository');
const { InMemoryTranscodeJobRepository }   = require('../../src/infrastructure/InMemoryTranscodeJobRepository');
const { Video }                            = require('../../src/domain/Video');
const { TranscodeJob }                     = require('../../src/domain/TranscodeJob');

const READ_CALLER  = { permissions: ['video:read'],  userId: 'user-1' };
const NO_PERM      = { permissions: [], userId: 'nobody' };

function makeUseCase() {
  const videoRepository        = new InMemoryVideoRepository();
  const transcodeJobRepository = new InMemoryTranscodeJobRepository();
  const uc = new GetTranscodeJobUseCase({ videoRepository, transcodeJobRepository });
  return { uc, videoRepository, transcodeJobRepository };
}

async function seedVideo(repo) {
  const v = Video.create({ videoId: 'vid-1', title: '제목', uploaderId: 'user-1', originalFileRef: 'ref', accessPolicy: 'PUBLIC' });
  await repo.save(v);
  return v;
}

async function seedJob(repo, opts = {}) {
  const job = TranscodeJob.create({
    jobId:            opts.jobId            || 'job-1',
    videoId:          opts.videoId          || 'vid-1',
    targetFormat:     opts.targetFormat     || 'MP4',
    targetResolution: opts.targetResolution || '1080p',
  });
  await repo.save(job);
  return job;
}

describe('GetTranscodeJobUseCase', () => {
  test('정상 조회 — video:read 권한 + 존재하는 Job', async () => {
    const { uc, videoRepository, transcodeJobRepository } = makeUseCase();
    await seedVideo(videoRepository);
    await seedJob(transcodeJobRepository);
    const job = await uc.execute({ videoId: 'vid-1', jobId: 'job-1' }, READ_CALLER);
    assert.equal(job.jobId, 'job-1');
    assert.equal(job.videoId, 'vid-1');
    assert.equal(job.status, 'PENDING');
  });

  test('권한 없음 → FORBIDDEN', async () => {
    const { uc, videoRepository, transcodeJobRepository } = makeUseCase();
    await seedVideo(videoRepository);
    await seedJob(transcodeJobRepository);
    await assert.rejects(
      () => uc.execute({ videoId: 'vid-1', jobId: 'job-1' }, NO_PERM),
      { code: 'FORBIDDEN' },
    );
  });

  test('존재하지 않는 videoId → NOT_FOUND', async () => {
    const { uc, transcodeJobRepository } = makeUseCase();
    await seedJob(transcodeJobRepository);
    await assert.rejects(
      () => uc.execute({ videoId: 'nonexistent', jobId: 'job-1' }, READ_CALLER),
      { code: 'NOT_FOUND' },
    );
  });

  test('존재하지 않는 jobId → NOT_FOUND', async () => {
    const { uc, videoRepository } = makeUseCase();
    await seedVideo(videoRepository);
    await assert.rejects(
      () => uc.execute({ videoId: 'vid-1', jobId: 'nonexistent' }, READ_CALLER),
      { code: 'NOT_FOUND' },
    );
  });

  test('다른 videoId의 Job 조회 시도 → NOT_FOUND (소유권 강제)', async () => {
    const { uc, videoRepository, transcodeJobRepository } = makeUseCase();
    await seedVideo(videoRepository);
    // job은 vid-2에 속하지만 vid-1로 조회 시도
    await seedJob(transcodeJobRepository, { jobId: 'job-x', videoId: 'vid-2' });
    await assert.rejects(
      () => uc.execute({ videoId: 'vid-1', jobId: 'job-x' }, READ_CALLER),
      { code: 'NOT_FOUND' },
    );
  });

  test('RUNNING 상태 Job 조회 성공', async () => {
    const { uc, videoRepository, transcodeJobRepository } = makeUseCase();
    await seedVideo(videoRepository);
    const pending = TranscodeJob.create({ jobId: 'job-r', videoId: 'vid-1', targetFormat: 'HLS', targetResolution: '720p' });
    const running = pending.transitionTo('RUNNING');
    await transcodeJobRepository.save(running);
    const job = await uc.execute({ videoId: 'vid-1', jobId: 'job-r' }, READ_CALLER);
    assert.equal(job.status, 'RUNNING');
  });

  // ── GAP-V003 회귀 테스트 ────────────────────────────────────────────────────
  test('[회귀] PRIVATE 영상의 Job을 비소유자가 조회 → FORBIDDEN (INV-V003)', async () => {
    const { uc, videoRepository, transcodeJobRepository } = makeUseCase();
    // PRIVATE 영상 (uploaderId: user-1)
    const v = Video.create({ videoId: 'priv-1', title: '비공개', uploaderId: 'user-1', originalFileRef: 'ref', accessPolicy: 'PRIVATE' });
    await videoRepository.save(v);
    await seedJob(transcodeJobRepository, { jobId: 'job-p', videoId: 'priv-1' });
    const attacker = { permissions: ['video:read'], userId: 'attacker-99' };
    await assert.rejects(
      () => uc.execute({ videoId: 'priv-1', jobId: 'job-p' }, attacker),
      { code: 'FORBIDDEN' },
    );
  });

  test('[회귀] PRIVATE 영상의 Job을 소유자가 조회 → 성공 (INV-V003)', async () => {
    const { uc, videoRepository, transcodeJobRepository } = makeUseCase();
    const v = Video.create({ videoId: 'priv-2', title: '비공개', uploaderId: 'user-1', originalFileRef: 'ref', accessPolicy: 'PRIVATE' });
    await videoRepository.save(v);
    await seedJob(transcodeJobRepository, { jobId: 'job-q', videoId: 'priv-2' });
    const job = await uc.execute({ videoId: 'priv-2', jobId: 'job-q' }, READ_CALLER);
    assert.equal(job.jobId, 'job-q');
  });

  test('COMPLETED 상태 Job + outputRenditionRef 포함 조회 성공', async () => {
    const { uc, videoRepository, transcodeJobRepository } = makeUseCase();
    await seedVideo(videoRepository);
    const job = TranscodeJob.create({ jobId: 'job-c', videoId: 'vid-1', targetFormat: 'MP4', targetResolution: '4K' })
      .transitionTo('RUNNING')
      .transitionTo('COMPLETED', { outputRenditionRef: 's3://bucket/output.mp4' });
    await transcodeJobRepository.save(job);
    const result = await uc.execute({ videoId: 'vid-1', jobId: 'job-c' }, READ_CALLER);
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.outputRenditionRef, 's3://bucket/output.mp4');
    assert.ok(result.completedAt);
  });
});
