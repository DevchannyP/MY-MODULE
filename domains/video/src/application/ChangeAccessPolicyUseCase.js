// @ts-check
'use strict';

/**
 * ChangeAccessPolicyUseCase
 * 권한: video:write
 * INV-V003: AccessPolicy 변경 — ARCHIVED 영상은 변경 불가
 */
class ChangeAccessPolicyUseCase {
  /**
   * @param {{ videoRepository: import('../ports/VideoRepository').VideoRepository }} deps
   */
  constructor({ videoRepository }) {
    this._videoRepo = videoRepository;
  }

  /**
   * @param {{ videoId: string, accessPolicy: string }} cmd
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

    const video = await this._videoRepo.findById(cmd.videoId);
    if (!video) {
      throw Object.assign(
        new Error(`Video를 찾을 수 없습니다: ${cmd.videoId}`),
        { code: 'NOT_FOUND' },
      );
    }

    const updated = video.changeAccessPolicy(cmd.accessPolicy);
    return this._videoRepo.save(updated);
  }
}

module.exports = { ChangeAccessPolicyUseCase };
