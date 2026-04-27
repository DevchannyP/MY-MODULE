// @ts-check
'use strict';

/**
 * VideoRepository 포트 (인터페이스 계약)
 *
 * 구현체는 이 인터페이스를 따라야 한다.
 * 도메인 코어는 이 포트만 참조한다 (Clean Architecture: 의존 역전).
 *
 * @interface
 */
class VideoRepository {
  /**
   * @param {string} videoId
   * @returns {Promise<import('../domain/Video').Video|null>}
   */
  // eslint-disable-next-line no-unused-vars
  async findById(videoId) { throw new Error('Not implemented'); }

  /**
   * @param {{ status?: string, uploaderId?: string, page?: number, pageSize?: number }} [opts]
   * @returns {Promise<{ items: import('../domain/Video').Video[], total: number, page: number, page_size: number }>}
   */
  // eslint-disable-next-line no-unused-vars
  async findAll(opts) { throw new Error('Not implemented'); }

  /**
   * @param {import('../domain/Video').Video} video
   * @returns {Promise<import('../domain/Video').Video>}
   */
  // eslint-disable-next-line no-unused-vars
  async save(video) { throw new Error('Not implemented'); }
}

module.exports = { VideoRepository };
