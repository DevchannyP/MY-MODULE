// @ts-check
'use strict';

/**
 * InMemoryTranscodeJobRepository — 테스트·개발용 인메모리 구현체
 */
class InMemoryTranscodeJobRepository {
  constructor() {
    this._store = new Map();
  }

  /** @param {string} jobId */
  async findById(jobId) {
    return this._store.get(jobId) || null;
  }

  /**
   * INV-V004 지원: Video당 RUNNING 상태 Job 조회
   * @param {string} videoId
   */
  async findRunningByVideoId(videoId) {
    for (const job of this._store.values()) {
      if (job.videoId === videoId && job.status === 'RUNNING') {
        return job;
      }
    }
    return null;
  }

  /** @param {string} videoId */
  async findAllByVideoId(videoId) {
    return Array.from(this._store.values()).filter(j => j.videoId === videoId);
  }

  /** @param {import('./TranscodeJob').TranscodeJob} job */
  async save(job) {
    this._store.set(job.jobId, job);
    return job;
  }

  /** 테스트 헬퍼 */
  clear() { this._store.clear(); }
  size()  { return this._store.size; }
}

module.exports = { InMemoryTranscodeJobRepository };
