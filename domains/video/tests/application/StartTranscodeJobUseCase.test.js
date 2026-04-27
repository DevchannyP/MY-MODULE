'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { StartTranscodeJobUseCase }          = require('../../src/application/StartTranscodeJobUseCase');
const { InMemoryVideoRepository }           = require('../../src/infrastructure/InMemoryVideoRepository');
const { InMemoryTranscodeJobRepository }    = require('../../src/infrastructure/InMemoryTranscodeJobRepository');
const { Video }                             = require('../../src/domain/Video');
const { TranscodeJob }                      = require('../../src/domain/TranscodeJob');

const WRITE_CALLER = { permissions: ['video:write'], userId: 'user-1' };
const NO_PERM      = { permissions: [], userId: 'nobody' };

function makeUseCase() {
  const videoRepository           = new InMemoryVideoRepository();
  const transcodeJobRepository    = new InMemoryTranscodeJobRepository();
  const uc = new StartTranscodeJobUseCase({ videoRepository, transcodeJobRepository });
  return { uc, videoRepository, transcodeJobRepository };
}

async function seedVideo(repo) {
  const v = Video.create({ videoId: 'vid-1', title: '제목', uploaderId: 'user-1', originalFileRef: 'ref' });
  await repo.save(v);
  return v;
}

describe('StartTranscodeJobUseCase', () => {
  test('정상 시작 — PENDING 상태 TranscodeJob 반환', async () => {
    const { uc, videoRepository } = makeUseCase();
    await seedVideo(videoRepository);
    const job = await uc.execute(
      { videoId: 'vid-1', targetFormat: 'MP4', targetResolution: '1080p' },
      WRITE_CALLER,
    );
    assert.equal(job.status, 'PENDING');
    assert.equal(job.videoId, 'vid-1');
    assert.ok(job.jobId);
  });

  test('권한 없음 → FORBIDDEN 에러', async () => {
    const { uc, videoRepository } = makeUseCase();
    await seedVideo(videoRepository);
    await assert.rejects(
      () => uc.execute({ videoId: 'vid-1', targetFormat: 'MP4', targetResolution: '1080p' }, NO_PERM),
      { code: 'FORBIDDEN' },
    );
  });

  test('Video 없음 → NOT_FOUND 에러', async () => {
    const { uc } = makeUseCase();
    await assert.rejects(
      () => uc.execute({ videoId: 'nonexistent', targetFormat: 'MP4', targetResolution: '1080p' }, WRITE_CALLER),
      { code: 'NOT_FOUND' },
    );
  });

  test('INV-V004: 이미 RUNNING Job 존재 → CONFLICT 에러', async () => {
    const { uc, videoRepository, transcodeJobRepository } = makeUseCase();
    await seedVideo(videoRepository);

    // 첫 번째 Job을 PENDING → RUNNING 상태로 저장
    const job1 = TranscodeJob.create({ jobId: 'job-existing', videoId: 'vid-1', targetFormat: 'MP4', targetResolution: '720p' });
    const runningJob = job1.transitionTo('RUNNING');
    await transcodeJobRepository.save(runningJob);

    // 두 번째 Job 시작 시도
    await assert.rejects(
      () => uc.execute({ videoId: 'vid-1', targetFormat: 'HLS', targetResolution: '1080p' }, WRITE_CALLER),
      { code: 'CONFLICT' },
    );
  });

  test('[회귀] ARCHIVED 영상 트랜스코딩 시도 → CONFLICT (INV-V002 terminal 상태)', async () => {
    const { uc, videoRepository } = makeUseCase();
    // ARCHIVED 영상 시드
    let v = Video.create({ videoId: 'vid-arch', title: '제목', uploaderId: 'user-1', originalFileRef: 'ref' });
    v = v.transitionTo('PROCESSING').transitionTo('READY').transitionTo('ARCHIVED');
    await videoRepository.save(v);

    await assert.rejects(
      () => uc.execute({ videoId: 'vid-arch', targetFormat: 'MP4', targetResolution: '1080p' }, WRITE_CALLER),
      { code: 'CONFLICT' },
    );
  });

  test('INV-V004: PENDING Job만 있으면 새 Job 시작 가능 (RUNNING 아님)', async () => {
    const { uc, videoRepository, transcodeJobRepository } = makeUseCase();
    await seedVideo(videoRepository);

    // PENDING 상태 Job만 존재 (RUNNING 아님)
    const pendingJob = TranscodeJob.create({ jobId: 'job-pending', videoId: 'vid-1', targetFormat: 'MP4', targetResolution: '720p' });
    await transcodeJobRepository.save(pendingJob);

    // 새 Job 시작 가능
    const job2 = await uc.execute(
      { videoId: 'vid-1', targetFormat: 'HLS', targetResolution: '1080p' },
      WRITE_CALLER,
    );
    assert.equal(job2.status, 'PENDING');
  });
});
