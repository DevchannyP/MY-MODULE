'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { ArchiveVideoUseCase }         = require('../../src/application/ArchiveVideoUseCase');
const { InMemoryVideoRepository }     = require('../../src/infrastructure/InMemoryVideoRepository');
const { Video }                       = require('../../src/domain/Video');

const ADMIN_CALLER = { permissions: ['video:admin'], userId: 'admin-1' };
const WRITE_CALLER = { permissions: ['video:write'], userId: 'user-1' };
const NO_PERM      = { permissions: [], userId: 'nobody' };

function makeUseCase() {
  const videoRepository = new InMemoryVideoRepository();
  const uc = new ArchiveVideoUseCase({ videoRepository });
  return { uc, videoRepository };
}

async function seedVideo(repo, status = 'READY') {
  let v = Video.create({ videoId: 'vid-1', title: '제목', uploaderId: 'user-1', originalFileRef: 'ref' });
  if (status === 'PROCESSING' || status === 'READY' || status === 'ARCHIVED') {
    v = v.transitionTo('PROCESSING');
  }
  if (status === 'READY' || status === 'ARCHIVED') {
    v = v.transitionTo('READY');
  }
  if (status === 'ARCHIVED') {
    v = v.transitionTo('ARCHIVED');
  }
  await repo.save(v);
  return v;
}

describe('ArchiveVideoUseCase', () => {
  test('READY → ARCHIVED 성공 (INV-V002)', async () => {
    const { uc, videoRepository } = makeUseCase();
    await seedVideo(videoRepository, 'READY');
    const video = await uc.execute({ videoId: 'vid-1' }, ADMIN_CALLER);
    assert.equal(video.status, 'ARCHIVED');
  });

  test('권한 없음 (NO_PERM) → FORBIDDEN 에러', async () => {
    const { uc, videoRepository } = makeUseCase();
    await seedVideo(videoRepository, 'READY');
    await assert.rejects(
      () => uc.execute({ videoId: 'vid-1' }, NO_PERM),
      { code: 'FORBIDDEN' },
    );
  });

  test('video:write만으로는 아카이브 불가 (video:admin 필요)', async () => {
    const { uc, videoRepository } = makeUseCase();
    await seedVideo(videoRepository, 'READY');
    await assert.rejects(
      () => uc.execute({ videoId: 'vid-1' }, WRITE_CALLER),
      { code: 'FORBIDDEN' },
    );
  });

  test('UPLOADED → ARCHIVED 실패 (INV-V002)', async () => {
    const { uc, videoRepository } = makeUseCase();
    await seedVideo(videoRepository, 'UPLOADED');
    await assert.rejects(
      () => uc.execute({ videoId: 'vid-1' }, ADMIN_CALLER),
      { code: 'CONFLICT' },
    );
  });

  test('PROCESSING → ARCHIVED 실패 (INV-V002)', async () => {
    const { uc, videoRepository } = makeUseCase();
    await seedVideo(videoRepository, 'PROCESSING');
    await assert.rejects(
      () => uc.execute({ videoId: 'vid-1' }, ADMIN_CALLER),
      { code: 'CONFLICT' },
    );
  });

  test('존재하지 않는 Video → NOT_FOUND 에러', async () => {
    const { uc } = makeUseCase();
    await assert.rejects(
      () => uc.execute({ videoId: 'nonexistent' }, ADMIN_CALLER),
      { code: 'NOT_FOUND' },
    );
  });

  test('이미 ARCHIVED 영상 재아카이브 시도 → CONFLICT (INV-V002)', async () => {
    const { uc, videoRepository } = makeUseCase();
    await seedVideo(videoRepository, 'ARCHIVED');
    await assert.rejects(
      () => uc.execute({ videoId: 'vid-1' }, ADMIN_CALLER),
      { code: 'CONFLICT' },
    );
  });
});
