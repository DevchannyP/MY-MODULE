// @ts-check
'use strict';

/**
 * TranscodeJob 집합체
 *
 * 불변조건:
 *   INV-V004: Video당 동시에 하나의 RUNNING 상태 Job만 허용 (Repository 계층에서 검사)
 *   INV-V005: COMPLETED 상태의 Job은 output_rendition_ref가 반드시 존재해야 한다
 */

const VALID_JOB_TRANSITIONS = Object.freeze({
  PENDING:   Object.freeze(['RUNNING', 'FAILED']),
  RUNNING:   Object.freeze(['COMPLETED', 'FAILED']),
  COMPLETED: Object.freeze([]),
  FAILED:    Object.freeze([]),
});

const VALID_JOB_STATUSES = Object.freeze(Object.keys(VALID_JOB_TRANSITIONS));
const VALID_FORMATS      = Object.freeze(['MP4', 'HLS', 'DASH']);

class TranscodeJob {
  /**
   * @param {{
   *   jobId: string,
   *   videoId: string,
   *   status: string,
   *   targetFormat: string,
   *   targetResolution: string,
   *   outputRenditionRef?: string|null,
   *   progressPercent?: number|null,
   *   errorMessage?: string|null,
   *   createdAt: string,
   *   completedAt?: string|null,
   * }} snapshot
   */
  constructor(snapshot) {
    this.jobId              = snapshot.jobId;
    this.videoId            = snapshot.videoId;
    this.status             = snapshot.status;
    this.targetFormat       = snapshot.targetFormat;
    this.targetResolution   = snapshot.targetResolution;
    this.outputRenditionRef = snapshot.outputRenditionRef || null;
    this.progressPercent    = snapshot.progressPercent ?? null;
    this.errorMessage       = snapshot.errorMessage       || null;
    this.createdAt          = snapshot.createdAt;
    this.completedAt        = snapshot.completedAt        || null;
    Object.freeze(this);
  }

  /**
   * 상태 전이 (불변 패턴)
   * INV-V005: COMPLETED 전이 시 outputRenditionRef 필수
   * @param {string} nextStatus
   * @param {{ outputRenditionRef?: string, errorMessage?: string, progressPercent?: number }} [opts]
   * @returns {TranscodeJob}
   */
  transitionTo(nextStatus, opts = {}) {
    const allowed = VALID_JOB_TRANSITIONS[this.status];
    if (!allowed || !allowed.includes(nextStatus)) {
      throw Object.assign(
        new Error(`INV-V002: TranscodeJob ${this.status} → ${nextStatus} 전이는 허용되지 않는다`),
        { code: 'CONFLICT' },
      );
    }

    if (nextStatus === 'COMPLETED') {
      const ref = opts.outputRenditionRef || this.outputRenditionRef;
      if (!ref || ref.trim() === '') {
        throw Object.assign(
          new Error('INV-V005: COMPLETED 상태의 TranscodeJob은 output_rendition_ref가 필수입니다'),
          { code: 'VALIDATION_ERROR' },
        );
      }
    }

    return new TranscodeJob({
      ...this._snapshot(),
      status:             nextStatus,
      outputRenditionRef: opts.outputRenditionRef || this.outputRenditionRef || null,
      progressPercent:    opts.progressPercent !== undefined ? opts.progressPercent : this.progressPercent,
      errorMessage:       opts.errorMessage       || this.errorMessage || null,
      completedAt:        nextStatus === 'COMPLETED' || nextStatus === 'FAILED'
        ? new Date().toISOString()
        : this.completedAt,
    });
  }

  /** @returns {object} */
  _snapshot() {
    return {
      jobId:              this.jobId,
      videoId:            this.videoId,
      status:             this.status,
      targetFormat:       this.targetFormat,
      targetResolution:   this.targetResolution,
      outputRenditionRef: this.outputRenditionRef,
      progressPercent:    this.progressPercent,
      errorMessage:       this.errorMessage,
      createdAt:          this.createdAt,
      completedAt:        this.completedAt,
    };
  }

  /**
   * 팩토리: 신규 TranscodeJob 생성 (항상 PENDING)
   * @param {{
   *   jobId: string,
   *   videoId: string,
   *   targetFormat: string,
   *   targetResolution: string,
   * }} params
   * @returns {TranscodeJob}
   */
  static create({ jobId, videoId, targetFormat, targetResolution }) {
    if (!videoId || videoId.trim() === '') {
      throw Object.assign(
        new Error('videoId는 필수입니다'),
        { code: 'VALIDATION_ERROR' },
      );
    }
    if (!VALID_FORMATS.includes(targetFormat)) {
      throw Object.assign(
        new Error(`유효하지 않은 targetFormat: ${targetFormat}. 허용값: ${VALID_FORMATS.join(', ')}`),
        { code: 'VALIDATION_ERROR' },
      );
    }
    if (!targetResolution || targetResolution.trim() === '') {
      throw Object.assign(
        new Error('targetResolution은 필수입니다'),
        { code: 'VALIDATION_ERROR' },
      );
    }

    const now = new Date().toISOString();
    return new TranscodeJob({
      jobId,
      videoId:          videoId.trim(),
      status:           'PENDING',
      targetFormat,
      targetResolution: targetResolution.trim(),
      outputRenditionRef: null,
      progressPercent:    null,
      errorMessage:       null,
      createdAt:          now,
      completedAt:        null,
    });
  }
}

module.exports = { TranscodeJob, VALID_JOB_TRANSITIONS, VALID_JOB_STATUSES, VALID_FORMATS };
