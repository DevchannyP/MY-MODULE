// @ts-check
'use strict';

/**
 * TranscodeJobRepository 포트 (인터페이스 계약)
 *
 * @interface
 */
class TranscodeJobRepository {
  /**
   * @param {string} jobId
   * @returns {Promise<import('../domain/TranscodeJob').TranscodeJob|null>}
   */
  // eslint-disable-next-line no-unused-vars
  async findById(jobId) { throw new Error('Not implemented'); }

  /**
   * @param {string} videoId
   * @returns {Promise<import('../domain/TranscodeJob').TranscodeJob|null>}
   */
  // eslint-disable-next-line no-unused-vars
  async findRunningByVideoId(videoId) { throw new Error('Not implemented'); }

  /**
   * @param {string} videoId
   * @returns {Promise<import('../domain/TranscodeJob').TranscodeJob[]>}
   */
  // eslint-disable-next-line no-unused-vars
  async findAllByVideoId(videoId) { throw new Error('Not implemented'); }

  /**
   * @param {import('../domain/TranscodeJob').TranscodeJob} job
   * @returns {Promise<import('../domain/TranscodeJob').TranscodeJob>}
   */
  // eslint-disable-next-line no-unused-vars
  async save(job) { throw new Error('Not implemented'); }
}

module.exports = { TranscodeJobRepository };
