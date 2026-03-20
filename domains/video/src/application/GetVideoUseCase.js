// @ts-check
'use strict';

/**
 * GetVideoUseCase
 * 권한: video:read
 * INV-V003: PRIVATE 영상은 uploader_id만 조회 가능
 */
class GetVideoUseCase {
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

    // INV-V003: PRIVATE 영상은 uploaderId 본인 또는 video:admin만 접근 가능
    const isAdmin = caller.permissions.includes('video:admin');
    if (!isAdmin && !video.canRead(caller.userId || '')) {
      throw Object.assign(
        new Error('INV-V003: PRIVATE 영상은 업로더 본인만 접근 가능합니다'),
        { code: 'FORBIDDEN' },
      );
    }

    return video;
  }
}

module.exports = { GetVideoUseCase };
