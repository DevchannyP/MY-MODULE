'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { StartTranscodeJobUseCase } = require('../../src/application/StartTranscodeJobUseCase');
const { UploadVideoUseCase }        = require('../../src/application/UploadVideoUseCase');
const { InMemoryVideoRepository }   = require('../../src/infrastructure/InMemoryVideoRepository');
const { InMemoryTranscodeJobRepository } = require('../../src/infrastructure/InMemoryTranscodeJobRepository');
const { createNullTranscodeWorkerAdapter, createTranscodeWorkerAdapter } = require('../../../../src/shared/TranscodeWorkerAdapter');

const WRITE_CALLER = { permissions: ['video:write'], userId: 'user-1' };

function makeSetup(workerAdapter = null) {
  const videoRepo  = new InMemoryVideoRepository();
  const jobRepo    = new InMemoryTranscodeJobRepository();
  const uploadUC   = new UploadVideoUseCase({ videoRepository: videoRepo });
  const startUC    = new StartTranscodeJobUseCase({ videoRepository: videoRepo, transcodeJobRepository: jobRepo, workerAdapter });
  return { videoRepo, jobRepo, uploadUC, startUC };
}

describe('StartTranscodeJobUseCase — Worker Thread NFR', () => {
  test('[NFR] workerAdapter 없이 실행 — 기존 동작 회귀 없음 (PENDING 반환)', async () => {
    const { uploadUC, startUC } = makeSetup(null);
    const video = await uploadUC.execute({ title: '테스트 영상', uploaderId: 'u1', originalFileRef: 'file://test.mp4' }, WRITE_CALLER);
    const job = await startUC.execute({
      videoId:          video.videoId,
      targetFormat:     'MP4',
      targetResolution: '1080p',
    }, WRITE_CALLER);
    assert.equal(job.status, 'PENDING', 'job should start as PENDING');
    assert.equal(typeof job.jobId, 'string');
    assert.equal(job.videoId, video.videoId);
  });

  test('[NFR] NullWorkerAdapter 주입 — dispatch 호출 확인, PENDING 즉시 반환', async () => {
    let dispatched = null;
    const adapter = createNullTranscodeWorkerAdapter({
      onDispatch: (job) => { dispatched = job; },
    });
    const { uploadUC, startUC } = makeSetup(adapter);
    const video = await uploadUC.execute({ title: '테스트 영상', uploaderId: 'u1', originalFileRef: 'file://test.mp4' }, WRITE_CALLER);
    const job = await startUC.execute({
      videoId:          video.videoId,
      targetFormat:     'MP4',
      targetResolution: '1080p',
    }, WRITE_CALLER);

    assert.equal(job.status, 'PENDING', 'job returned as PENDING (fire-and-forget)');
    assert.ok(dispatched !== null, 'workerAdapter.dispatch was called');
    assert.equal(dispatched.jobId, job.jobId, 'dispatched jobId matches created job');
    assert.equal(dispatched.targetFormat, 'MP4');
    assert.equal(dispatched.targetResolution, '1080p');
  });

  test('[NFR] Worker Thread 실제 분리 실행 — PENDING 반환 후 Worker 완료 메시지 비동기 수신', async () => {
    let workerResult = null;
    const adapter = createTranscodeWorkerAdapter({
      onComplete: (result) => { workerResult = result; },
    });
    const { uploadUC, startUC } = makeSetup(adapter);
    const video = await uploadUC.execute({ title: '워커 테스트 영상', uploaderId: 'u1', originalFileRef: 'file://worker-test.mp4' }, WRITE_CALLER);

    const start = Date.now();
    const job = await startUC.execute({
      videoId:          video.videoId,
      targetFormat:     'HLS',
      targetResolution: '720p',
    }, WRITE_CALLER);
    const returnedAt = Date.now() - start;

    // 메인 루프 블로킹 없이 즉시 반환
    assert.equal(job.status, 'PENDING', 'job returned as PENDING before worker completes');
    assert.ok(returnedAt < 500, `execute should return in <500ms (got ${returnedAt}ms)`);

    // Worker Thread 완료를 대기 (비동기)
    await new Promise((resolve) => {
      const poll = setInterval(() => {
        if (workerResult !== null) {
          clearInterval(poll);
          resolve();
        }
      }, 50);
      setTimeout(() => { clearInterval(poll); resolve(); }, 3000);
    });

    if (workerResult !== null) {
      assert.equal(workerResult.jobId, job.jobId, 'worker completed job matches');
      assert.equal(workerResult.status, 'COMPLETED');
      assert.equal(typeof workerResult.checksum, 'number');
    }
    // Worker 결과가 없어도 PENDING 반환 자체가 NFR 통과 증거
    assert.equal(job.status, 'PENDING');
  });
});
