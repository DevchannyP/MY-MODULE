'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { ChangeAccessPolicyUseCase }    = require('../../src/application/ChangeAccessPolicyUseCase');
const { InMemoryVideoRepository }      = require('../../src/domain/InMemoryVideoRepository');
const { Video }                        = require('../../src/domain/Video');

const WRITE_CALLER = { permissions: ['video:write'], userId: 'user-1' };
const NO_PERM      = { permissions: [], userId: 'nobody' };

function makeUseCase() {
  const videoRepository = new InMemoryVideoRepository();
  const uc = new ChangeAccessPolicyUseCase({ videoRepository });
  return { uc, videoRepository };
}

async function seedVideo(repo, status = 'UPLOADED', accessPolicy = 'PRIVATE') {
  let v = Video.create({ videoId: 'vid-1', title: '제목', uploaderId: 'user-1', originalFileRef: 'ref', accessPolicy });
  if (status === 'PROCESSING')                               v = v.transitionTo('PROCESSING');
  if (status === 'READY')      { v = v.transitionTo('PROCESSING'); v = v.transitionTo('READY'); }
  if (status === 'ARCHIVED')   { v = v.transitionTo('PROCESSING'); v = v.transitionTo('READY'); v = v.transitionTo('ARCHIVED'); }
  await repo.save(v);
  return v;
}

describe('ChangeAccessPolicyUseCase', () => {
  test('정상 변경 — PRIVATE → PUBLIC', async () => {
    const { uc, videoRepository } = makeUseCase();
    await seedVideo(videoRepository);
    const video = await uc.execute({ videoId: 'vid-1', accessPolicy: 'PUBLIC' }, WRITE_CALLER);
    assert.equal(video.accessPolicy, 'PUBLIC');
  });

  test('정상 변경 — PUBLIC → ORG_INTERNAL', async () => {
    const { uc, videoRepository } = makeUseCase();
    await seedVideo(videoRepository, 'UPLOADED', 'PUBLIC');
    const video = await uc.execute({ videoId: 'vid-1', accessPolicy: 'ORG_INTERNAL' }, WRITE_CALLER);
    assert.equal(video.accessPolicy, 'ORG_INTERNAL');
  });

  test('권한 없음 → FORBIDDEN 에러', async () => {
    const { uc, videoRepository } = makeUseCase();
    await seedVideo(videoRepository);
    await assert.rejects(
      () => uc.execute({ videoId: 'vid-1', accessPolicy: 'PUBLIC' }, NO_PERM),
      { code: 'FORBIDDEN' },
    );
  });

  test('존재하지 않는 Video → NOT_FOUND 에러', async () => {
    const { uc } = makeUseCase();
    await assert.rejects(
      () => uc.execute({ videoId: 'nonexistent', accessPolicy: 'PUBLIC' }, WRITE_CALLER),
      { code: 'NOT_FOUND' },
    );
  });

  test('ARCHIVED 영상 정책 변경 불가 (INV-V002)', async () => {
    const { uc, videoRepository } = makeUseCase();
    await seedVideo(videoRepository, 'ARCHIVED');
    await assert.rejects(
      () => uc.execute({ videoId: 'vid-1', accessPolicy: 'PUBLIC' }, WRITE_CALLER),
      { code: 'CONFLICT' },
    );
  });

  test('PROCESSING 상태에서도 정책 변경 가능', async () => {
    const { uc, videoRepository } = makeUseCase();
    await seedVideo(videoRepository, 'PROCESSING');
    const video = await uc.execute({ videoId: 'vid-1', accessPolicy: 'PUBLIC' }, WRITE_CALLER);
    assert.equal(video.accessPolicy, 'PUBLIC');
  });
});
