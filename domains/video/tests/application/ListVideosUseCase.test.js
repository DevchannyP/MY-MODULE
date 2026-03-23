'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { ListVideosUseCase }       = require('../../src/application/ListVideosUseCase');
const { UploadVideoUseCase }      = require('../../src/application/UploadVideoUseCase');
const { InMemoryVideoRepository } = require('../../src/infrastructure/InMemoryVideoRepository');

const READ_CALLER  = { permissions: ['video:read'],  userId: 'user-1' };
const OTHER_CALLER = { permissions: ['video:read'],  userId: 'user-2' };
const ADMIN_CALLER = { permissions: ['video:read', 'video:admin'], userId: 'admin-1' };
const WRITE_CALLER = { permissions: ['video:write'], userId: 'user-1' };
const NO_PERM      = { permissions: [], userId: 'nobody' };

function makeSetup() {
  const videoRepository = new InMemoryVideoRepository();
  const listUC   = new ListVideosUseCase({ videoRepository });
  const uploadUC = new UploadVideoUseCase({ videoRepository });
  return { listUC, uploadUC, videoRepository };
}

describe('ListVideosUseCase', () => {
  test('정상 조회 — 빈 저장소', async () => {
    const { listUC } = makeSetup();
    const result = await listUC.execute({}, READ_CALLER);
    assert.equal(result.total, 0);
    assert.deepEqual(result.items, []);
  });

  test('FORBIDDEN — video:read 권한 없음', async () => {
    const { listUC } = makeSetup();
    await assert.rejects(
      () => listUC.execute({}, NO_PERM),
      { code: 'FORBIDDEN' },
    );
  });

  test('PUBLIC 영상은 모든 video:read 사용자에게 노출', async () => {
    const { listUC, uploadUC } = makeSetup();
    await uploadUC.execute(
      { title: '공개영상', uploaderId: 'user-1', originalFileRef: 'ref1', accessPolicy: 'PUBLIC' },
      WRITE_CALLER,
    );
    const result = await listUC.execute({}, OTHER_CALLER);
    assert.equal(result.items.length, 1);
  });

  // ── GAP-V001 회귀 테스트 ────────────────────────────────────────────────────
  test('[회귀] PRIVATE 영상은 비소유자에게 노출되지 않음 (INV-V003)', async () => {
    const { listUC, uploadUC } = makeSetup();
    // user-1이 PRIVATE 영상 업로드
    await uploadUC.execute(
      { title: '비공개영상', uploaderId: 'user-1', originalFileRef: 'ref1', accessPolicy: 'PRIVATE' },
      WRITE_CALLER,
    );
    // user-2가 목록 조회 → 비공개 영상 보이면 안 됨
    const result = await listUC.execute({}, OTHER_CALLER);
    assert.equal(result.items.length, 0, 'PRIVATE 영상이 비소유자에게 노출됨 (GAP-V001 재발)');
    assert.equal(result.total, 0, 'total이 필터링 전 값을 반환함 (페이지네이션 오판 버그)');
  });

  test('[회귀] PRIVATE 영상은 소유자 본인에게는 노출', async () => {
    const { listUC, uploadUC } = makeSetup();
    await uploadUC.execute(
      { title: '비공개영상', uploaderId: 'user-1', originalFileRef: 'ref1', accessPolicy: 'PRIVATE' },
      WRITE_CALLER,
    );
    const result = await listUC.execute({}, READ_CALLER);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].accessPolicy, 'PRIVATE');
  });

  test('[회귀] video:admin은 PRIVATE 영상 포함 전체 목록 조회 가능', async () => {
    const { listUC, uploadUC } = makeSetup();
    await uploadUC.execute(
      { title: '비공개영상', uploaderId: 'user-1', originalFileRef: 'ref1', accessPolicy: 'PRIVATE' },
      WRITE_CALLER,
    );
    const result = await listUC.execute({}, ADMIN_CALLER);
    assert.equal(result.items.length, 1);
  });

  test('혼합 정책 — PUBLIC + PRIVATE 혼재 시 비소유자에게 PUBLIC만 노출', async () => {
    const { listUC, uploadUC, videoRepository } = makeSetup();
    // user-1: PUBLIC + PRIVATE 영상
    await uploadUC.execute(
      { title: '공개', uploaderId: 'user-1', originalFileRef: 'r1', accessPolicy: 'PUBLIC' },
      WRITE_CALLER,
    );
    await uploadUC.execute(
      { title: '비공개', uploaderId: 'user-1', originalFileRef: 'r2', accessPolicy: 'PRIVATE' },
      WRITE_CALLER,
    );
    // user-2 조회 → PUBLIC만 보임
    const result = await listUC.execute({}, OTHER_CALLER);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].accessPolicy, 'PUBLIC');
    void videoRepository; // suppress lint
  });

  test('uploaderId 필터 적용 — 본인 업로드 영상만 조회', async () => {
    const { listUC, uploadUC } = makeSetup();
    await uploadUC.execute(
      { title: '영상1', uploaderId: 'user-1', originalFileRef: 'r1', accessPolicy: 'PUBLIC' },
      WRITE_CALLER,
    );
    await uploadUC.execute(
      { title: '영상2', uploaderId: 'user-2', originalFileRef: 'r2', accessPolicy: 'PUBLIC' },
      { permissions: ['video:write'], userId: 'user-2' },
    );
    const result = await listUC.execute({ uploaderId: 'user-1' }, READ_CALLER);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].uploaderId, 'user-1');
  });

  test('[회귀] 권한 필터는 페이지네이션보다 먼저 적용된다', async () => {
    const { listUC, uploadUC } = makeSetup();
    await uploadUC.execute(
      { title: '비공개영상', uploaderId: 'user-1', originalFileRef: 'private-ref', accessPolicy: 'PRIVATE' },
      WRITE_CALLER,
    );
    await uploadUC.execute(
      { title: '공개영상', uploaderId: 'user-1', originalFileRef: 'public-ref', accessPolicy: 'PUBLIC' },
      WRITE_CALLER,
    );

    const result = await listUC.execute({ page: 1, pageSize: 1 }, OTHER_CALLER);
    assert.equal(result.total, 1);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].accessPolicy, 'PUBLIC');
  });
});
