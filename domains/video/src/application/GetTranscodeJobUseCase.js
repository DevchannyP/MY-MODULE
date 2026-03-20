// @ts-check
'use strict';

/**
 * GetTranscodeJobUseCase
 * 권한: video:read
 */
class GetTranscodeJobUseCase {
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
   * @param {{ videoId: string, jobId: string }} cmd
   * @param {{ permissions: string[], userId?: string }} caller
   * @returns {Promise<import('../domain/TranscodeJob').TranscodeJob>}
   */
  async execute(cmd, caller) {
    if (!caller?.permissions?.includes('video:read')) {
      throw Object.assign(
        new Error('Forbidden: video:read 권한이 필요합니다'),
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

    const job = await this._jobRepo.findById(cmd.jobId);
    if (!job || job.videoId !== cmd.videoId) {
      throw Object.assign(
        new Error(`TranscodeJob을 찾을 수 없습니다: ${cmd.jobId}`),
        { code: 'NOT_FOUND' },
      );
    }

    return job;
  }
}

module.exports = { GetTranscodeJobUseCase };
