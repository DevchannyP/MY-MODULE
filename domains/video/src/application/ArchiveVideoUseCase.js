// @ts-check
'use strict';

/**
 * ArchiveVideoUseCase
 * 권한: video:admin
 * INV-V002: READY 상태에서만 ARCHIVED 전이 가능
 */
class ArchiveVideoUseCase {
  /**
   * @param {{ videoRepository: import('../ports/VideoRepository').VideoRepository }} deps
   */
  constructor({ videoRepository }) {
    this._videoRepo = videoRepository;
  }

  /**
   * @param {{ videoId: string }} cmd
   * @param {{ permissions: string[], userId?: string }} caller
   * @returns {Promise<import('../domain/Video').Video>}
   */
  async execute(cmd, caller) {
    if (!caller?.permissions?.includes('video:admin')) {
      throw Object.assign(
        new Error('Forbidden: video:admin 권한이 필요합니다'),
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

    // INV-V002: transitionTo에서 허용되지 않은 전이면 CONFLICT 에러 발생
    const archived = video.transitionTo('ARCHIVED');
    return this._videoRepo.save(archived);
  }
}

module.exports = { ArchiveVideoUseCase };
