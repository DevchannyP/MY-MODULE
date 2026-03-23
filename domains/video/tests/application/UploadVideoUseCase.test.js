'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { UploadVideoUseCase }         = require('../../src/application/UploadVideoUseCase');
const { InMemoryVideoRepository }    = require('../../src/infrastructure/InMemoryVideoRepository');

const WRITE_CALLER = { permissions: ['video:write'], userId: 'user-1' };
const NO_PERM      = { permissions: [], userId: 'nobody' };

function makeUseCase() {
  const videoRepository = new InMemoryVideoRepository();
  const uc = new UploadVideoUseCase({ videoRepository });
  return { uc, videoRepository };
}

describe('UploadVideoUseCase', () => {
  test('정상 업로드 — UPLOADED 상태 Video 반환', async () => {
    const { uc } = makeUseCase();
    const video = await uc.execute(
      { title: '테스트', uploaderId: 'user-1', originalFileRef: 's3://bucket/v.mp4' },
      WRITE_CALLER,
    );
    assert.equal(video.status, 'UPLOADED');
    assert.equal(video.title, '테스트');
    assert.ok(video.videoId);
  });

  test('권한 없음 → FORBIDDEN 에러', async () => {
    const { uc } = makeUseCase();
    await assert.rejects(
      () => uc.execute(
        { title: '테스트', uploaderId: 'u1', originalFileRef: 'ref' },
        NO_PERM,
      ),
      { code: 'FORBIDDEN' },
    );
  });

  test('title 누락 → VALIDATION_ERROR (INV-V001)', async () => {
    const { uc } = makeUseCase();
    await assert.rejects(
      () => uc.execute(
        { title: '', uploaderId: 'u1', originalFileRef: 'ref' },
        WRITE_CALLER,
      ),
      /INV-V001/,
    );
  });

  test('originalFileRef 누락 → VALIDATION_ERROR (INV-V001)', async () => {
    const { uc } = makeUseCase();
    await assert.rejects(
      () => uc.execute(
        { title: '제목', uploaderId: 'u1', originalFileRef: '' },
        WRITE_CALLER,
      ),
      /INV-V001/,
    );
  });

  test('기본 accessPolicy는 PRIVATE', async () => {
    const { uc } = makeUseCase();
    const video = await uc.execute(
      { title: '제목', uploaderId: 'u1', originalFileRef: 'ref' },
      WRITE_CALLER,
    );
    assert.equal(video.accessPolicy, 'PRIVATE');
  });

  test('업로드 후 repository에 저장됨', async () => {
    const { uc, videoRepository } = makeUseCase();
    const video = await uc.execute(
      { title: '제목', uploaderId: 'u1', originalFileRef: 'ref' },
      WRITE_CALLER,
    );
    const found = await videoRepository.findById(video.videoId);
    assert.ok(found);
    assert.equal(found.videoId, video.videoId);
  });
});
