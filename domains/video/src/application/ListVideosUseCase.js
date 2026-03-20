// @ts-check
'use strict';

/**
 * ListVideosUseCase
 * 권한: video:read
 */
class ListVideosUseCase {
  /**
   * @param {{ videoRepository: import('../ports/VideoRepository').VideoRepository }} deps
   */
  constructor({ videoRepository }) {
    this._videoRepo = videoRepository;
  }

  /**
   * @param {{ status?: string, uploaderId?: string, page?: number, pageSize?: number }} cmd
   * @param {{ permissions: string[], userId?: string }} caller
   */
  async execute(cmd, caller) {
    if (!caller?.permissions?.includes('video:read')) {
      throw Object.assign(
        new Error('Forbidden: video:read 권한이 필요합니다'),
        { code: 'FORBIDDEN' },
      );
    }

    return this._videoRepo.findAll({
      status:     cmd.status,
      uploaderId: cmd.uploaderId,
      page:       cmd.page     || 1,
      pageSize:   cmd.pageSize || 20,
    });
  }
}

module.exports = { ListVideosUseCase };
