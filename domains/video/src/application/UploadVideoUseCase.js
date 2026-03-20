// @ts-check
'use strict';

const { randomUUID } = require('crypto');
const { Video }      = require('../domain/Video');

/**
 * UploadVideoUseCase
 * 권한: video:write
 * 결과: UPLOADED 상태 Video 생성
 * INV-V001: title, uploaderId, originalFileRef 필수
 */
class UploadVideoUseCase {
  /**
   * @param {{ videoRepository: import('../ports/VideoRepository').VideoRepository }} deps
   */
  constructor({ videoRepository }) {
    this._videoRepo = videoRepository;
  }

  /**
   * @param {{
   *   title: string,
   *   uploaderId: string,
   *   originalFileRef: string,
   *   accessPolicy?: string,
   *   description?: string|null,
   *   fileSizeBytes?: number|null,
   * }} cmd
   * @param {{ permissions: string[], userId?: string }} caller
   * @returns {Promise<import('../domain/Video').Video>}
   */
  async execute(cmd, caller) {
    if (!caller?.permissions?.includes('video:write')) {
      throw Object.assign(
        new Error('Forbidden: video:write 권한이 필요합니다'),
        { code: 'FORBIDDEN' },
      );
    }

    const video = Video.create({
      videoId:         randomUUID(),
      title:           cmd.title,
      uploaderId:      cmd.uploaderId,
      originalFileRef: cmd.originalFileRef,
      accessPolicy:    cmd.accessPolicy    || 'PRIVATE',
      description:     cmd.description     || null,
      fileSizeBytes:   cmd.fileSizeBytes   || null,
    });

    return this._videoRepo.save(video);
  }
}

module.exports = { UploadVideoUseCase };
