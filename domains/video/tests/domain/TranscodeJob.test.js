'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { TranscodeJob } = require('../../src/domain/TranscodeJob');

function validCreate(overrides = {}) {
  return TranscodeJob.create({
    jobId:            'job-1',
    videoId:          'vid-1',
    targetFormat:     'MP4',
    targetResolution: '1080p',
    ...overrides,
  });
}

describe('TranscodeJob Entity', () => {

  describe('TranscodeJob.create()', () => {
    test('유효한 입력으로 PENDING 상태 생성', () => {
      const job = validCreate();
      assert.equal(job.status, 'PENDING');
      assert.equal(job.videoId, 'vid-1');
      assert.equal(job.targetFormat, 'MP4');
      assert.equal(job.targetResolution, '1080p');
      assert.equal(job.outputRenditionRef, null);
    });

    test('videoId 누락 → 에러', () => {
      assert.throws(() => validCreate({ videoId: '' }), /videoId는 필수/);
    });

    test('유효하지 않은 targetFormat → 에러', () => {
      assert.throws(() => validCreate({ targetFormat: 'AVI' }), /유효하지 않은 targetFormat/);
    });

    test('targetResolution 누락 → 에러', () => {
      assert.throws(() => validCreate({ targetResolution: '' }), /targetResolution은 필수/);
    });

    test('HLS 포맷 지원', () => {
      const job = validCreate({ targetFormat: 'HLS' });
      assert.equal(job.targetFormat, 'HLS');
    });

    test('DASH 포맷 지원', () => {
      const job = validCreate({ targetFormat: 'DASH' });
      assert.equal(job.targetFormat, 'DASH');
    });
  });

  describe('INV-V004: 상태 전이 검증', () => {
    test('PENDING → RUNNING 허용', () => {
      const job = validCreate().transitionTo('RUNNING');
      assert.equal(job.status, 'RUNNING');
    });

    test('RUNNING → COMPLETED 허용 (outputRenditionRef 필수)', () => {
      const job = validCreate()
        .transitionTo('RUNNING')
        .transitionTo('COMPLETED', { outputRenditionRef: 's3://bucket/output.mp4' });
      assert.equal(job.status, 'COMPLETED');
      assert.equal(job.outputRenditionRef, 's3://bucket/output.mp4');
    });

    test('RUNNING → FAILED 허용', () => {
      const job = validCreate()
        .transitionTo('RUNNING')
        .transitionTo('FAILED', { errorMessage: '트랜스코딩 실패' });
      assert.equal(job.status, 'FAILED');
      assert.equal(job.errorMessage, '트랜스코딩 실패');
    });

    test('PENDING → FAILED 허용', () => {
      const job = validCreate().transitionTo('FAILED');
      assert.equal(job.status, 'FAILED');
    });

    test('COMPLETED → RUNNING 금지', () => {
      const job = validCreate()
        .transitionTo('RUNNING')
        .transitionTo('COMPLETED', { outputRenditionRef: 'ref' });
      assert.throws(() => job.transitionTo('RUNNING'), /전이는 허용되지 않는다/);
    });

    test('FAILED → RUNNING 금지', () => {
      const job = validCreate().transitionTo('FAILED');
      assert.throws(() => job.transitionTo('RUNNING'), /전이는 허용되지 않는다/);
    });

    test('상태 전이 후 새 인스턴스 반환 (불변 패턴)', () => {
      const before = validCreate();
      const after  = before.transitionTo('RUNNING');
      assert.notEqual(before, after);
      assert.equal(before.status, 'PENDING');
      assert.equal(after.status, 'RUNNING');
    });
  });

  describe('INV-V005: COMPLETED 시 output_rendition_ref 필수', () => {
    test('outputRenditionRef 없이 COMPLETED → INV-V005 에러', () => {
      const job = validCreate().transitionTo('RUNNING');
      assert.throws(
        () => job.transitionTo('COMPLETED'),
        /INV-V005/,
      );
    });

    test('빈 문자열 outputRenditionRef → INV-V005 에러', () => {
      const job = validCreate().transitionTo('RUNNING');
      assert.throws(
        () => job.transitionTo('COMPLETED', { outputRenditionRef: '' }),
        /INV-V005/,
      );
    });

    test('유효한 outputRenditionRef로 COMPLETED 성공', () => {
      const job = validCreate()
        .transitionTo('RUNNING')
        .transitionTo('COMPLETED', { outputRenditionRef: 's3://bucket/out.mp4' });
      assert.equal(job.outputRenditionRef, 's3://bucket/out.mp4');
    });
  });
});
