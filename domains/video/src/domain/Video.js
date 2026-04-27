// @ts-check
'use strict';

/**
 * Video 집합체 루트
 *
 * 불변조건:
 *   INV-V001: title, uploader_id, original_file_ref 필수
 *   INV-V002: 상태 전이 단방향 — UPLOADED→PROCESSING→READY→ARCHIVED
 *             FAILED는 UPLOADED 또는 PROCESSING에서 진입 가능 (현실적 요구사항)
 *   INV-V003: AccessPolicy PRIVATE → uploader_id만 재생 가능
 */

/** @type {Record<string, string[]>} */
const VALID_TRANSITIONS = Object.freeze({
  UPLOADED:   Object.freeze(['PROCESSING', 'FAILED']),
  PROCESSING: Object.freeze(['READY', 'FAILED']),
  READY:      Object.freeze(['ARCHIVED']),
  FAILED:     Object.freeze([]),
  ARCHIVED:   Object.freeze([]),
});


const VALID_ACCESS_POLICIES = Object.freeze(['PUBLIC', 'PRIVATE', 'ORG_INTERNAL']);

class Video {
  /**
   * @param {{
   *   videoId: string,
   *   title: string,
   *   uploaderId: string,
   *   originalFileRef: string,
   *   status: string,
   *   accessPolicy: string,
   *   description?: string|null,
   *   durationSeconds?: number|null,
   *   fileSizeBytes?: number|null,
   *   createdAt: string,
   *   updatedAt: string,
   * }} snapshot
   */
  constructor(snapshot) {
    this.videoId         = snapshot.videoId;
    this.title           = snapshot.title;
    this.uploaderId      = snapshot.uploaderId;
    this.originalFileRef = snapshot.originalFileRef;
    this.status          = snapshot.status;
    this.accessPolicy    = snapshot.accessPolicy;
    this.description     = snapshot.description ?? null;
    this.durationSeconds = snapshot.durationSeconds ?? null;
    this.fileSizeBytes   = snapshot.fileSizeBytes ?? null;
    this.createdAt       = snapshot.createdAt;
    this.updatedAt       = snapshot.updatedAt;
    Object.freeze(this);
  }

  /**
   * INV-V002: 상태 전이 (불변 패턴 — 새 인스턴스 반환)
   * @param {string} nextStatus
   * @returns {Video}
   */
  transitionTo(nextStatus) {
    const allowed = VALID_TRANSITIONS[this.status];
    if (!allowed || !allowed.includes(nextStatus)) {
      throw Object.assign(
        new Error(`INV-V002: ${this.status} → ${nextStatus} 전이는 허용되지 않는다`),
        { code: 'CONFLICT' },
      );
    }
    return new Video({
      ...this._snapshot(),
      status:    nextStatus,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * INV-V003: AccessPolicy 변경 (불변 패턴)
   * ARCHIVED 상태에서는 변경 불가
   * @param {string} newPolicy
   * @returns {Video}
   */
  changeAccessPolicy(newPolicy) {
    if (!VALID_ACCESS_POLICIES.includes(newPolicy)) {
      throw Object.assign(
        new Error(`유효하지 않은 AccessPolicy: ${newPolicy}. 허용값: ${VALID_ACCESS_POLICIES.join(', ')}`),
        { code: 'VALIDATION_ERROR' },
      );
    }
    if (this.status === 'ARCHIVED') {
      throw Object.assign(
        new Error('INV-V002: ARCHIVED 영상의 접근정책은 변경할 수 없다'),
        { code: 'CONFLICT' },
      );
    }
    return new Video({
      ...this._snapshot(),
      accessPolicy: newPolicy,
      updatedAt:    new Date().toISOString(),
    });
  }

  /**
   * INV-V003: PRIVATE 영상에 대해 특정 사용자의 재생 가능 여부 확인
   * @param {string} requesterId
   * @returns {boolean}
   */
  canRead(requesterId) {
    if (this.accessPolicy === 'PRIVATE') {
      return requesterId === this.uploaderId;
    }
    return true;
  }

  /** @returns {object} */
  _snapshot() {
    return {
      videoId:         this.videoId,
      title:           this.title,
      uploaderId:      this.uploaderId,
      originalFileRef: this.originalFileRef,
      status:          this.status,
      accessPolicy:    this.accessPolicy,
      description:     this.description,
      durationSeconds: this.durationSeconds,
      fileSizeBytes:   this.fileSizeBytes,
      createdAt:       this.createdAt,
      updatedAt:       this.updatedAt,
    };
  }

  /**
   * 팩토리: 신규 Video 생성 (항상 UPLOADED 상태)
   * INV-V001: title, uploaderId, originalFileRef 필수
   * @param {{
   *   videoId: string,
   *   title: string,
   *   uploaderId: string,
   *   originalFileRef: string,
   *   accessPolicy?: string,
   *   description?: string|null,
   *   fileSizeBytes?: number|null,
   * }} params
   * @returns {Video}
   */
  static create({ videoId, title, uploaderId, originalFileRef, accessPolicy, description, fileSizeBytes }) {
    if (!title || title.trim() === '') {
      throw Object.assign(
        new Error('INV-V001: title은 필수입니다'),
        { code: 'VALIDATION_ERROR' },
      );
    }
    if (!uploaderId || uploaderId.trim() === '') {
      throw Object.assign(
        new Error('INV-V001: uploader_id는 필수입니다'),
        { code: 'VALIDATION_ERROR' },
      );
    }
    if (!originalFileRef || originalFileRef.trim() === '') {
      throw Object.assign(
        new Error('INV-V001: original_file_ref는 필수입니다'),
        { code: 'VALIDATION_ERROR' },
      );
    }

    const policy = accessPolicy || 'PRIVATE';
    if (!VALID_ACCESS_POLICIES.includes(policy)) {
      throw Object.assign(
        new Error(`유효하지 않은 AccessPolicy: ${policy}`),
        { code: 'VALIDATION_ERROR' },
      );
    }

    const now = new Date().toISOString();
    return new Video({
      videoId,
      title:           title.trim(),
      uploaderId:      uploaderId.trim(),
      originalFileRef: originalFileRef.trim(),
      status:          'UPLOADED',
      accessPolicy:    policy,
      description:     description ?? null,
      durationSeconds: null,
      fileSizeBytes:   fileSizeBytes ?? null,
      createdAt:       now,
      updatedAt:       now,
    });
  }
}

module.exports = { Video, VALID_TRANSITIONS, VALID_ACCESS_POLICIES };
