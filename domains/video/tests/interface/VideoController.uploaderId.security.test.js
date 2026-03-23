'use strict';

/**
 * VideoController 보안 회귀 테스트 — uploaderId 소유권 강제
 * 수정 전 취약점: body.uploader_id로 다른 사용자를 업로더로 위장 가능했음
 * 수정 후: caller.userId만 사용 (body.uploader_id 무시)
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { VideoController }                = require('../../src/interface/VideoController');
const { InMemoryVideoRepository }        = require('../../src/infrastructure/InMemoryVideoRepository');
const { InMemoryTranscodeJobRepository } = require('../../src/infrastructure/InMemoryTranscodeJobRepository');

function makeCtrl() {
  return new VideoController({
    videoRepository:        new InMemoryVideoRepository(),
    transcodeJobRepository: new InMemoryTranscodeJobRepository(),
  });
}

describe('[보안] VideoController uploaderId 소유권 강제', () => {
  test('caller.userId가 uploaderId로 사용됨 (body.uploader_id 무시)', async () => {
    const ctrl = makeCtrl();
    const res  = await ctrl.handle({
      method: 'POST', path: '/videos',
      body: {
        title:           '내 영상',
        original_file_ref: 's3://bucket/v.mp4',
        uploader_id:     'attacker-trying-to-fake-owner',  // 이 값은 무시되어야 함
      },
      caller: { permissions: ['video:write'], userId: 'real-user-123' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.uploader_id, 'real-user-123',
      '업로더가 body.uploader_id로 오염됨 — 소유권 위장 취약점');
    assert.notEqual(res.body.uploader_id, 'attacker-trying-to-fake-owner');
  });

  test('caller.userId 없는 경우 빈 uploaderId → VALIDATION_ERROR', async () => {
    const ctrl = makeCtrl();
    const res  = await ctrl.handle({
      method: 'POST', path: '/videos',
      body: { title: '영상', original_file_ref: 'ref' },
      caller: { permissions: ['video:write'] },  // userId 없음
    });
    // uploaderId='' → INV-V001 VALIDATION_ERROR → 400
    assert.equal(res.status, 400);
  });

  test('두 사용자가 서로 다른 uploaderId로 영상 생성', async () => {
    const ctrl = makeCtrl();

    const res1 = await ctrl.handle({
      method: 'POST', path: '/videos',
      body: { title: '영상1', original_file_ref: 'ref1' },
      caller: { permissions: ['video:write'], userId: 'user-A' },
    });
    const res2 = await ctrl.handle({
      method: 'POST', path: '/videos',
      body: { title: '영상2', original_file_ref: 'ref2' },
      caller: { permissions: ['video:write'], userId: 'user-B' },
    });

    assert.equal(res1.body.uploader_id, 'user-A');
    assert.equal(res2.body.uploader_id, 'user-B');
    assert.notEqual(res1.body.uploader_id, res2.body.uploader_id);
  });
});
