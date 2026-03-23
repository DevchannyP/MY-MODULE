// @ts-check
'use strict';

/**
 * InMemoryVideoRepository — 테스트·개발용 인메모리 구현체
 */
class InMemoryVideoRepository {
  constructor() {
    this._store = new Map();
  }

  /** @param {string} videoId */
  async findById(videoId) {
    return this._store.get(videoId) || null;
  }

  /** @param {{ status?: string, uploaderId?: string, page?: number, pageSize?: number }} [opts] */
  async findAll({ status, uploaderId, page = 1, pageSize = 20 } = {}) {
    let items = Array.from(this._store.values());

    if (status)     items = items.filter(v => v.status    === status);
    if (uploaderId) items = items.filter(v => v.uploaderId === uploaderId);

    const total  = items.length;
    const offset = (page - 1) * pageSize;
    const paged  = items.slice(offset, offset + pageSize);

    return { items: paged, total, page, page_size: pageSize };
  }

  /** @param {import('../domain/Video').Video} video */
  async save(video) {
    this._store.set(video.videoId, video);
    return video;
  }

  /** 테스트 헬퍼 */
  clear() { this._store.clear(); }
  size()  { return this._store.size; }
}

module.exports = { InMemoryVideoRepository };
