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

    const result = await this._videoRepo.findAll({
      status:     cmd.status,
      uploaderId: cmd.uploaderId,
      page:       cmd.page     || 1,
      pageSize:   cmd.pageSize || 20,
    });

    // INV-V003: video:admin이 아닌 경우 PRIVATE 영상은 본인 것만 노출
    const isAdmin = caller.permissions.includes('video:admin');
    if (!isAdmin) {
      result.items = result.items.filter(v => v.canRead(caller.userId || ''));
      result.total = result.items.length;
    }

    return result;
  }
}

module.exports = { ListVideosUseCase };
