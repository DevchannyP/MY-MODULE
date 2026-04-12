'use strict';

const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

// ── Worker Thread 실행 코드 (같은 파일, isMainThread 분기) ──────────────────
if (!isMainThread) {
  // Worker 측: CPU-bound 트랜스코딩 시뮬레이션
  const { jobId, videoId, targetFormat, targetResolution } = workerData;

  // 트랜스코딩 시뮬레이션 (CPU-bound: 해상도 비례 연산 루프)
  const iterations = targetResolution === '4K' ? 200_000 : targetResolution === '1080p' ? 100_000 : 50_000;
  let checksum = 0;
  for (let i = 0; i < iterations; i++) {
    checksum = (checksum + i * 7) % 1_000_000_007;
  }

  parentPort.postMessage({
    jobId,
    videoId,
    targetFormat,
    targetResolution,
    status: 'COMPLETED',
    checksum,
    completedAt: new Date().toISOString(),
  });
  return;
}

// ── Main Thread 측: Worker Thread 래핑 어댑터 ──────────────────────────────

/**
 * TranscodeWorkerAdapter
 * CPU-bound 트랜스코딩 시뮬레이션을 Worker Thread로 분리 실행.
 * fire-and-forget: dispatch 호출 즉시 반환. 완료 콜백 선택적.
 *
 * @param {{ onComplete?: (result: object) => void, onError?: (err: Error) => void }} [opts]
 */
function createTranscodeWorkerAdapter({ onComplete = null, onError = null } = {}) {
  return {
    /**
     * @param {{ jobId: string, videoId: string, targetFormat: string, targetResolution: string }} job
     */
    dispatch(job) {
      const worker = new Worker(__filename, {
        workerData: {
          jobId: job.jobId,
          videoId: job.videoId,
          targetFormat: job.targetFormat,
          targetResolution: job.targetResolution,
        },
      });

      worker.once('message', (result) => {
        if (typeof onComplete === 'function') {
          onComplete(result);
        }
      });

      worker.once('error', (err) => {
        if (typeof onError === 'function') {
          onError(err);
        }
      });

      worker.once('exit', (code) => {
        if (code !== 0 && typeof onError === 'function') {
          onError(new Error(`Transcode worker exited with code ${code} for job ${job.jobId}`));
        }
      });
    },
  };
}

/**
 * NullTranscodeWorkerAdapter
 * 테스트/개발 환경용 no-op 어댑터. Worker Thread를 실제로 생성하지 않음.
 * @param {{ onDispatch?: (job: object) => void }} [opts]
 */
function createNullTranscodeWorkerAdapter({ onDispatch = null } = {}) {
  return {
    dispatch(job) {
      if (typeof onDispatch === 'function') {
        onDispatch(job);
      }
    },
  };
}

module.exports = {
  createTranscodeWorkerAdapter,
  createNullTranscodeWorkerAdapter,
};
