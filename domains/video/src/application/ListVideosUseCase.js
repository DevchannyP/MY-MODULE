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

    const page = Number.isInteger(cmd.page) && cmd.page > 0 ? cmd.page : 1;
    const pageSize = Number.isInteger(cmd.pageSize) && cmd.pageSize > 0 ? cmd.pageSize : 20;
    const result = await this._videoRepo.findAll({
      status:     cmd.status,
      uploaderId: cmd.uploaderId,
      page:       1,
      pageSize:   Number.MAX_SAFE_INTEGER,
    });

    // INV-V003: video:admin이 아닌 경우 PRIVATE 영상은 본인 것만 노출
    const isAdmin = caller.permissions.includes('video:admin');
    let visibleItems = result.items;
    if (!isAdmin) {
      visibleItems = visibleItems.filter(v => v.canRead(caller.userId || ''));
    }

    const total = visibleItems.length;
    const offset = (page - 1) * pageSize;

    return {
      items: visibleItems.slice(offset, offset + pageSize),
      total,
      page,
      page_size: pageSize,
    };
  }
}

module.exports = { ListVideosUseCase };
