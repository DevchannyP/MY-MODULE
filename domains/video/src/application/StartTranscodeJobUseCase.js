// @ts-check
'use strict';

const { randomUUID }    = require('crypto');
const { TranscodeJob }  = require('../domain/TranscodeJob');

/**
 * StartTranscodeJobUseCase
 * 권한: video:write
 * INV-V004: 동시에 하나의 RUNNING Job만 허용
 * RISK-V002: 비동기 처리 — Job ID만 반환 (PENDING 상태)
 */
class StartTranscodeJobUseCase {
  /**
   * @param {{
   *   videoRepository: import('../ports/VideoRepository').VideoRepository,
   *   transcodeJobRepository: import('../ports/TranscodeJobRepository').TranscodeJobRepository,
   * }} deps
   */
  constructor({ videoRepository, transcodeJobRepository }) {
    this._videoRepo = videoRepository;
    this._jobRepo   = transcodeJobRepository;
  }

  /**
   * @param {{
   *   videoId: string,
   *   targetFormat: string,
   *   targetResolution: string,
   * }} cmd
   * @param {{ permissions: string[], userId?: string }} caller
   * @returns {Promise<import('../domain/TranscodeJob').TranscodeJob>}
   */
  async execute(cmd, caller) {
    if (!caller?.permissions?.includes('video:write')) {
      throw Object.assign(
        new Error('Forbidden: video:write 권한이 필요합니다'),
        { code: 'FORBIDDEN' },
      );
    }

    const video = await this._videoRepo.findById(cmd.videoId);
    if (!video) {
      throw Object.assign(
        new Error(`Video를 찾을 수 없습니다: ${cmd.videoId}`),
        { code: 'NOT_FOUND' },
      );
    }

    // ARCHIVED 영상은 트랜스코딩 불가 (terminal 상태 — INV-V002)
    if (video.status === 'ARCHIVED') {
      throw Object.assign(
        new Error('INV-V002: ARCHIVED 영상은 트랜스코딩을 시작할 수 없습니다'),
        { code: 'CONFLICT' },
      );
    }

    // INV-V004: 동시 RUNNING Job 확인
    const runningJob = await this._jobRepo.findRunningByVideoId(cmd.videoId);
    if (runningJob) {
      throw Object.assign(
        new Error(`INV-V004: Video(${cmd.videoId})에 이미 RUNNING 상태의 TranscodeJob이 존재합니다: ${runningJob.jobId}`),
        { code: 'CONFLICT' },
      );
    }

    const job = TranscodeJob.create({
      jobId:            randomUUID(),
      videoId:          cmd.videoId,
      targetFormat:     cmd.targetFormat,
      targetResolution: cmd.targetResolution,
    });

    return this._jobRepo.save(job);
  }
}

module.exports = { StartTranscodeJobUseCase };
