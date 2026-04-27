'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { GetVideoUseCase }          = require('../../src/application/GetVideoUseCase');
const { InMemoryVideoRepository }  = require('../../src/infrastructure/InMemoryVideoRepository');
const { Video }                    = require('../../src/domain/Video');

const READ_CALLER  = { permissions: ['video:read'], userId: 'user-1' };
const OTHER_CALLER = { permissions: ['video:read'], userId: 'user-2' };
const NO_PERM      = { permissions: [], userId: 'nobody' };

function makeUseCase() {
  const videoRepository = new InMemoryVideoRepository();
  const uc = new GetVideoUseCase({ videoRepository });
  return { uc, videoRepository };
}

async function seedVideo(repo, overrides = {}) {
  const v = Video.create({
    videoId: 'vid-1', title: '제목', uploaderId: 'user-1', originalFileRef: 'ref',
    ...overrides,
  });
  await repo.save(v);
  return v;
}

describe('GetVideoUseCase', () => {
  test('PUBLIC 영상 — video:read 권한으로 조회 성공', async () => {
    const { uc, videoRepository } = makeUseCase();
    await seedVideo(videoRepository, { accessPolicy: 'PUBLIC' });
    const video = await uc.execute({ videoId: 'vid-1' }, OTHER_CALLER);
    assert.equal(video.videoId, 'vid-1');
  });

  test('존재하지 않는 videoId → NOT_FOUND 에러', async () => {
    const { uc } = makeUseCase();
    await assert.rejects(
      () => uc.execute({ videoId: 'nonexistent' }, READ_CALLER),
      { code: 'NOT_FOUND' },
    );
  });

  test('권한 없음 → FORBIDDEN 에러', async () => {
    const { uc, videoRepository } = makeUseCase();
    await seedVideo(videoRepository);
    await assert.rejects(
      () => uc.execute({ videoId: 'vid-1' }, NO_PERM),
      { code: 'FORBIDDEN' },
    );
  });

  test('INV-V003: PRIVATE 영상 — 업로더 본인은 조회 가능', async () => {
    const { uc, videoRepository } = makeUseCase();
    await seedVideo(videoRepository, { accessPolicy: 'PRIVATE' });
    const video = await uc.execute({ videoId: 'vid-1' }, READ_CALLER);
    assert.equal(video.videoId, 'vid-1');
  });

  test('INV-V003: PRIVATE 영상 — 다른 사용자는 FORBIDDEN', async () => {
    const { uc, videoRepository } = makeUseCase();
    await seedVideo(videoRepository, { accessPolicy: 'PRIVATE' });
    await assert.rejects(
      () => uc.execute({ videoId: 'vid-1' }, OTHER_CALLER),
      { code: 'FORBIDDEN' },
    );
  });

  test('[회귀] INV-V003: PRIVATE 영상 — video:admin은 조회 가능 (일관성)', async () => {
    const { uc, videoRepository } = makeUseCase();
    await seedVideo(videoRepository, { accessPolicy: 'PRIVATE' });
    const adminCaller = { permissions: ['video:read', 'video:admin'], userId: 'admin-1' };
    const video = await uc.execute({ videoId: 'vid-1' }, adminCaller);
    assert.equal(video.videoId, 'vid-1');
    assert.equal(video.accessPolicy, 'PRIVATE');
  });
});
