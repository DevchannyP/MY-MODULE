'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Video } = require('../../src/domain/Video');

function validCreate(overrides = {}) {
  return Video.create({
    videoId:         'vid-1',
    title:           '테스트 영상',
    uploaderId:      'user-1',
    originalFileRef: 's3://bucket/video.mp4',
    ...overrides,
  });
}

describe('Video Entity', () => {

  describe('INV-V001: Video.create() 필수 필드 검증', () => {
    test('유효한 입력으로 UPLOADED 상태 생성', () => {
      const v = validCreate();
      assert.equal(v.status, 'UPLOADED');
      assert.equal(v.title, '테스트 영상');
      assert.equal(v.uploaderId, 'user-1');
      assert.equal(v.originalFileRef, 's3://bucket/video.mp4');
    });

    test('title 누락 → INV-V001 에러', () => {
      assert.throws(
        () => validCreate({ title: '' }),
        /INV-V001.*title/,
      );
    });

    test('title undefined → INV-V001 에러', () => {
      assert.throws(
        () => Video.create({ videoId: 'v1', title: undefined, uploaderId: 'u1', originalFileRef: 'ref' }),
        /INV-V001.*title/,
      );
    });

    test('uploaderId 누락 → INV-V001 에러', () => {
      assert.throws(
        () => validCreate({ uploaderId: '' }),
        /INV-V001.*uploader_id/,
      );
    });

    test('originalFileRef 누락 → INV-V001 에러', () => {
      assert.throws(
        () => validCreate({ originalFileRef: '' }),
        /INV-V001.*original_file_ref/,
      );
    });

    test('기본 accessPolicy는 PRIVATE', () => {
      const v = validCreate();
      assert.equal(v.accessPolicy, 'PRIVATE');
    });

    test('accessPolicy 명시적으로 PUBLIC 지정', () => {
      const v = validCreate({ accessPolicy: 'PUBLIC' });
      assert.equal(v.accessPolicy, 'PUBLIC');
    });

    test('fileSizeBytes=0은 null로 손실되지 않는다', () => {
      const v = validCreate({ fileSizeBytes: 0 });
      assert.equal(v.fileSizeBytes, 0);
    });

    test('snapshot 기반 재구성 시 0 값(duration/fileSize)을 유지한다', () => {
      const v = new Video({
        videoId: 'vid-zero',
        title: '0 값 영상',
        uploaderId: 'user-1',
        originalFileRef: 's3://bucket/video-zero.mp4',
        status: 'READY',
        accessPolicy: 'PUBLIC',
        description: null,
        durationSeconds: 0,
        fileSizeBytes: 0,
        createdAt: '2026-03-23T00:00:00.000Z',
        updatedAt: '2026-03-23T00:00:00.000Z',
      });
      assert.equal(v.durationSeconds, 0);
      assert.equal(v.fileSizeBytes, 0);
    });
  });

  describe('INV-V002: 상태 전이 검증', () => {
    test('UPLOADED → PROCESSING 허용', () => {
      const v = validCreate().transitionTo('PROCESSING');
      assert.equal(v.status, 'PROCESSING');
    });

    test('PROCESSING → READY 허용', () => {
      const v = validCreate().transitionTo('PROCESSING').transitionTo('READY');
      assert.equal(v.status, 'READY');
    });

    test('READY → ARCHIVED 허용', () => {
      const v = validCreate().transitionTo('PROCESSING').transitionTo('READY').transitionTo('ARCHIVED');
      assert.equal(v.status, 'ARCHIVED');
    });

    test('UPLOADED → FAILED 허용', () => {
      const v = validCreate().transitionTo('FAILED');
      assert.equal(v.status, 'FAILED');
    });

    test('PROCESSING → FAILED 허용', () => {
      const v = validCreate().transitionTo('PROCESSING').transitionTo('FAILED');
      assert.equal(v.status, 'FAILED');
    });

    test('ARCHIVED → UPLOADED 금지 (INV-V002)', () => {
      const v = validCreate().transitionTo('PROCESSING').transitionTo('READY').transitionTo('ARCHIVED');
      assert.throws(() => v.transitionTo('UPLOADED'), /INV-V002/);
    });

    test('READY → UPLOADED 금지 (INV-V002)', () => {
      const v = validCreate().transitionTo('PROCESSING').transitionTo('READY');
      assert.throws(() => v.transitionTo('UPLOADED'), /INV-V002/);
    });

    test('FAILED → UPLOADED 금지 (INV-V002)', () => {
      const v = validCreate().transitionTo('FAILED');
      assert.throws(() => v.transitionTo('UPLOADED'), /INV-V002/);
    });

    test('ARCHIVED → PROCESSING 금지 (INV-V002)', () => {
      const v = validCreate().transitionTo('PROCESSING').transitionTo('READY').transitionTo('ARCHIVED');
      assert.throws(() => v.transitionTo('PROCESSING'), /INV-V002/);
    });

    test('UPLOADED → READY 직접 전이 금지 (INV-V002)', () => {
      assert.throws(() => validCreate().transitionTo('READY'), /INV-V002/);
    });

    test('상태 전이 후 새 인스턴스 반환 (불변 패턴)', () => {
      const before = validCreate();
      const after  = before.transitionTo('PROCESSING');
      assert.notEqual(before, after);
      assert.equal(before.status, 'UPLOADED');
      assert.equal(after.status, 'PROCESSING');
    });
  });

  describe('INV-V003: AccessPolicy PRIVATE 검증', () => {
    test('PRIVATE 영상 — 업로더 본인은 canRead = true', () => {
      const v = validCreate({ accessPolicy: 'PRIVATE' });
      assert.equal(v.canRead('user-1'), true);
    });

    test('PRIVATE 영상 — 다른 사용자는 canRead = false', () => {
      const v = validCreate({ accessPolicy: 'PRIVATE' });
      assert.equal(v.canRead('user-2'), false);
    });

    test('PUBLIC 영상 — 누구나 canRead = true', () => {
      const v = validCreate({ accessPolicy: 'PUBLIC' });
      assert.equal(v.canRead('user-2'), true);
    });

    test('ORG_INTERNAL 영상 — 누구나 canRead = true (정책 제한은 외부 계층)', () => {
      const v = validCreate({ accessPolicy: 'ORG_INTERNAL' });
      assert.equal(v.canRead('user-2'), true);
    });
  });

  describe('changeAccessPolicy() 검증', () => {
    test('정상 변경 — PUBLIC으로', () => {
      const v = validCreate({ accessPolicy: 'PRIVATE' }).changeAccessPolicy('PUBLIC');
      assert.equal(v.accessPolicy, 'PUBLIC');
    });

    test('ARCHIVED 영상은 정책 변경 불가 (INV-V002)', () => {
      const v = validCreate()
        .transitionTo('PROCESSING')
        .transitionTo('READY')
        .transitionTo('ARCHIVED');
      assert.throws(() => v.changeAccessPolicy('PUBLIC'), /INV-V002/);
    });

    test('유효하지 않은 정책값 거부', () => {
      assert.throws(() => validCreate().changeAccessPolicy('UNKNOWN'), /유효하지 않은 AccessPolicy/);
    });

    test('정책 변경 후 새 인스턴스 반환 (불변 패턴)', () => {
      const before = validCreate({ accessPolicy: 'PRIVATE' });
      const after  = before.changeAccessPolicy('PUBLIC');
      assert.notEqual(before, after);
      assert.equal(before.accessPolicy, 'PRIVATE');
      assert.equal(after.accessPolicy,  'PUBLIC');
    });
  });
});
