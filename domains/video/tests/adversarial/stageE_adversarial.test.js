'use strict';

/**
 * Stage E 적대적 검증 — Video Domain
 * 7개 공격 벡터: INV-V001~V005 우회 시도 + 객체 변형 공격 + 소유권 우회
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { Video }                           = require('../../src/domain/Video');
const { TranscodeJob }                    = require('../../src/domain/TranscodeJob');
const { InMemoryVideoRepository }         = require('../../src/domain/InMemoryVideoRepository');
const { InMemoryTranscodeJobRepository }  = require('../../src/domain/InMemoryTranscodeJobRepository');
const { UploadVideoUseCase }              = require('../../src/application/UploadVideoUseCase');
const { GetVideoUseCase }                 = require('../../src/application/GetVideoUseCase');
const { StartTranscodeJobUseCase }        = require('../../src/application/StartTranscodeJobUseCase');
const { ChangeAccessPolicyUseCase }       = require('../../src/application/ChangeAccessPolicyUseCase');
const { ArchiveVideoUseCase }             = require('../../src/application/ArchiveVideoUseCase');

// ── 1. INV-V001: 필수 필드 주입 공격 ─────────────────────────────────────────
describe('[Stage E] INV-V001: 필수 필드 공백/null 주입', () => {
  const repo = new InMemoryVideoRepository();
  const uc   = new UploadVideoUseCase({ videoRepository: repo });
  const WRITE = { permissions: ['video:write'], userId: 'user-1' };

  for (const [label, body] of [
    ['title 빈 문자열',    { title: '',    uploaderId: 'u', originalFileRef: 'ref' }],
    ['title 공백만',       { title: '   ', uploaderId: 'u', originalFileRef: 'ref' }],
    ['uploaderId 빈 문자', { title: 'T',   uploaderId: '', originalFileRef: 'ref' }],
    ['fileRef 빈 문자',    { title: 'T',   uploaderId: 'u', originalFileRef: '' }],
  ]) {
    test(`${label} → VALIDATION_ERROR`, async () => {
      await assert.rejects(
        () => uc.execute(body, WRITE),
        err => { assert.equal(err.code, 'VALIDATION_ERROR'); return true; }
      );
    });
  }
});

// ── 2. INV-V002: 터미널 상태 탈출 시도 ────────────────────────────────────────
describe('[Stage E] INV-V002: 터미널 상태에서 전이 불가', () => {
  test('ARCHIVED 영상에서 어떤 전이도 불가', () => {
    let v = Video.create({ videoId: 'v1', title: 'T', uploaderId: 'u', originalFileRef: 'r' });
    v = v.transitionTo('PROCESSING').transitionTo('READY').transitionTo('ARCHIVED');
    for (const next of ['UPLOADED', 'PROCESSING', 'READY', 'FAILED', 'ARCHIVED']) {
      assert.throws(
        () => v.transitionTo(next),
        err => { assert.equal(err.code, 'CONFLICT'); return true; },
        `ARCHIVED → ${next} 전이가 허용됨 (버그)`
      );
    }
  });

  test('FAILED 영상에서 어떤 전이도 불가', () => {
    let v = Video.create({ videoId: 'v2', title: 'T', uploaderId: 'u', originalFileRef: 'r' });
    v = v.transitionTo('FAILED');
    for (const next of ['UPLOADED', 'PROCESSING', 'READY', 'ARCHIVED']) {
      assert.throws(
        () => v.transitionTo(next),
        err => { assert.equal(err.code, 'CONFLICT'); return true; }
      );
    }
  });

  test('ARCHIVED 영상 아카이브 재시도 → CONFLICT (이중 아카이브 방어)', async () => {
    const videoRepo = new InMemoryVideoRepository();
    const archiveUC = new ArchiveVideoUseCase({ videoRepository: videoRepo });
    let v = Video.create({ videoId: 'v3', title: 'T', uploaderId: 'u', originalFileRef: 'r' });
    v = v.transitionTo('PROCESSING').transitionTo('READY').transitionTo('ARCHIVED');
    await videoRepo.save(v);
    await assert.rejects(
      () => archiveUC.execute({ videoId: 'v3' }, { permissions: ['video:admin'] }),
      err => { assert.equal(err.code, 'CONFLICT'); return true; }
    );
  });
});

// ── 3. INV-V003: PRIVATE 영상 소유권 우회 시도 ────────────────────────────────
describe('[Stage E] INV-V003: PRIVATE 영상 무단 접근 방어', () => {
  test('다른 사용자는 PRIVATE 영상 직접 조회 불가', async () => {
    const videoRepo = new InMemoryVideoRepository();
    const getUC     = new GetVideoUseCase({ videoRepository: videoRepo });
    const owner     = { permissions: ['video:read'], userId: 'owner-1' };
    const attacker  = { permissions: ['video:read'], userId: 'attacker-99' };

    const v = Video.create({ videoId: 'priv-1', title: '기밀 영상', uploaderId: 'owner-1', originalFileRef: 'ref', accessPolicy: 'PRIVATE' });
    await videoRepo.save(v);

    // 소유자는 접근 가능
    const result = await getUC.execute({ videoId: 'priv-1' }, owner);
    assert.equal(result.videoId, 'priv-1');

    // 공격자는 FORBIDDEN
    await assert.rejects(
      () => getUC.execute({ videoId: 'priv-1' }, attacker),
      err => { assert.equal(err.code, 'FORBIDDEN'); return true; }
    );
  });

  test('canRead() 직접 호출: PRIVATE + 다른 userId → false', () => {
    const v = Video.create({ videoId: 'v', title: 'T', uploaderId: 'owner', originalFileRef: 'r', accessPolicy: 'PRIVATE' });
    assert.equal(v.canRead('owner'), true);
    assert.equal(v.canRead('attacker'), false);
    assert.equal(v.canRead(''), false);
  });

  test('ARCHIVED 영상의 AccessPolicy 변경 시도 → CONFLICT', async () => {
    const videoRepo  = new InMemoryVideoRepository();
    const changeUC   = new ChangeAccessPolicyUseCase({ videoRepository: videoRepo });
    let v = Video.create({ videoId: 'v-arch', title: 'T', uploaderId: 'u', originalFileRef: 'r' });
    v = v.transitionTo('PROCESSING').transitionTo('READY').transitionTo('ARCHIVED');
    await videoRepo.save(v);
    // 소유자 본인이 시도해도 ARCHIVED 상태라 CONFLICT (INV-V002)
    await assert.rejects(
      () => changeUC.execute({ videoId: 'v-arch', accessPolicy: 'PUBLIC' }, { permissions: ['video:write'], userId: 'u' }),
      err => { assert.equal(err.code, 'CONFLICT'); return true; }
    );
  });

  test('유효하지 않은 AccessPolicy 주입 → VALIDATION_ERROR', () => {
    const v = Video.create({ videoId: 'v', title: 'T', uploaderId: 'u', originalFileRef: 'r' });
    for (const bad of ['', 'UNKNOWN', 'public', 'admin', 'DROP TABLE videos']) {
      assert.throws(
        () => v.changeAccessPolicy(bad),
        err => { assert.equal(err.code, 'VALIDATION_ERROR'); return true; },
        `잘못된 정책 "${bad}"가 허용됨 (버그)`
      );
    }
  });
});

// ── 4. INV-V004: 동시 RUNNING Job 강제 주입 시도 ─────────────────────────────
describe('[Stage E] INV-V004: 동시 RUNNING Job 방어', () => {
  test('이미 RUNNING Job 있으면 StartTranscodeJob → CONFLICT', async () => {
    const videoRepo = new InMemoryVideoRepository();
    const jobRepo   = new InMemoryTranscodeJobRepository();
    const startUC   = new StartTranscodeJobUseCase({ videoRepository: videoRepo, transcodeJobRepository: jobRepo });
    const WRITE     = { permissions: ['video:write'], userId: 'u' };

    const v = Video.create({ videoId: 'vid-x', title: 'T', uploaderId: 'u', originalFileRef: 'r' });
    await videoRepo.save(v);

    // 첫 번째 Job 생성 후 RUNNING으로 전이
    const job1 = TranscodeJob.create({ jobId: 'j1', videoId: 'vid-x', targetFormat: 'MP4', targetResolution: '1080p' });
    await jobRepo.save(job1.transitionTo('RUNNING'));

    // 두 번째 Job 시작 시도 → CONFLICT
    await assert.rejects(
      () => startUC.execute({ videoId: 'vid-x', targetFormat: 'HLS', targetResolution: '720p' }, WRITE),
      err => { assert.equal(err.code, 'CONFLICT'); return true; }
    );
  });

  test('COMPLETED Job 존재 시 새 Job 시작 가능 (RUNNING 아님)', async () => {
    const videoRepo = new InMemoryVideoRepository();
    const jobRepo   = new InMemoryTranscodeJobRepository();
    const startUC   = new StartTranscodeJobUseCase({ videoRepository: videoRepo, transcodeJobRepository: jobRepo });
    const WRITE     = { permissions: ['video:write'], userId: 'u' };

    const v = Video.create({ videoId: 'vid-y', title: 'T', uploaderId: 'u', originalFileRef: 'r' });
    await videoRepo.save(v);

    const completedJob = TranscodeJob.create({ jobId: 'j-done', videoId: 'vid-y', targetFormat: 'MP4', targetResolution: '1080p' })
      .transitionTo('RUNNING')
      .transitionTo('COMPLETED', { outputRenditionRef: 's3://out.mp4' });
    await jobRepo.save(completedJob);

    // COMPLETED Job 있을 때 새 Job 시작은 가능해야 함
    const newJob = await startUC.execute({ videoId: 'vid-y', targetFormat: 'HLS', targetResolution: '720p' }, WRITE);
    assert.equal(newJob.status, 'PENDING');
  });

  test('PENDING Job 존재 시 새 Job 시작 가능 (PENDING은 RUNNING이 아님)', async () => {
    const videoRepo = new InMemoryVideoRepository();
    const jobRepo   = new InMemoryTranscodeJobRepository();
    const startUC   = new StartTranscodeJobUseCase({ videoRepository: videoRepo, transcodeJobRepository: jobRepo });
    const WRITE     = { permissions: ['video:write'], userId: 'u' };

    const v = Video.create({ videoId: 'vid-z', title: 'T', uploaderId: 'u', originalFileRef: 'r' });
    await videoRepo.save(v);

    // PENDING Job 저장
    await jobRepo.save(TranscodeJob.create({ jobId: 'j-pend', videoId: 'vid-z', targetFormat: 'MP4', targetResolution: '720p' }));

    // PENDING은 RUNNING 아니므로 새 Job 시작 가능
    const newJob = await startUC.execute({ videoId: 'vid-z', targetFormat: 'HLS', targetResolution: '1080p' }, WRITE);
    assert.equal(newJob.status, 'PENDING');
  });
});

// ── 5. INV-V005: COMPLETED 없이 outputRenditionRef 누락 시도 ─────────────────
describe('[Stage E] INV-V005: COMPLETED 전이 시 outputRenditionRef 필수', () => {
  test('outputRenditionRef 없이 COMPLETED 전이 → VALIDATION_ERROR', () => {
    const job = TranscodeJob.create({ jobId: 'j', videoId: 'v', targetFormat: 'MP4', targetResolution: '1080p' })
      .transitionTo('RUNNING');
    assert.throws(
      () => job.transitionTo('COMPLETED'),
      err => { assert.equal(err.code, 'VALIDATION_ERROR'); return true; }
    );
  });

  test('outputRenditionRef 빈 문자열 → VALIDATION_ERROR', () => {
    const job = TranscodeJob.create({ jobId: 'j', videoId: 'v', targetFormat: 'MP4', targetResolution: '1080p' })
      .transitionTo('RUNNING');
    assert.throws(
      () => job.transitionTo('COMPLETED', { outputRenditionRef: '   ' }),
      err => { assert.equal(err.code, 'VALIDATION_ERROR'); return true; }
    );
  });

  test('FAILED 전이 시 outputRenditionRef 없어도 가능', () => {
    const job = TranscodeJob.create({ jobId: 'j', videoId: 'v', targetFormat: 'MP4', targetResolution: '1080p' })
      .transitionTo('RUNNING');
    const failed = job.transitionTo('FAILED', { errorMessage: '인코딩 실패' });
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.outputRenditionRef, null);
    assert.ok(failed.completedAt);
  });
});

// ── 6. 객체 동결 우회 시도 (불변 패턴 방어) ─────────────────────────────────
describe('[Stage E] 객체 불변성 방어', () => {
  test('Video는 Object.freeze — 속성 직접 변경 불가', () => {
    const v = Video.create({ videoId: 'v', title: '제목', uploaderId: 'u', originalFileRef: 'r' });
    assert.throws(() => { v.status = 'ARCHIVED'; }, /Cannot assign/);
    assert.equal(v.status, 'UPLOADED');
  });

  test('TranscodeJob은 Object.freeze — 속성 직접 변경 불가', () => {
    const j = TranscodeJob.create({ jobId: 'j', videoId: 'v', targetFormat: 'MP4', targetResolution: '1080p' });
    assert.throws(() => { j.status = 'COMPLETED'; }, /Cannot assign/);
    assert.equal(j.status, 'PENDING');
  });

  test('transitionTo는 새 인스턴스 반환 — 원본 불변', () => {
    const original = Video.create({ videoId: 'v', title: 'T', uploaderId: 'u', originalFileRef: 'r' });
    const next     = original.transitionTo('PROCESSING');
    assert.equal(original.status, 'UPLOADED',    '원본 Video가 변경됨 (버그)');
    assert.equal(next.status,     'PROCESSING');
    assert.notStrictEqual(original, next);
  });
});

// ── 7. 권한 우회: 잘못된 권한 조합 시도 ─────────────────────────────────────
describe('[Stage E] 권한 우회 공격 벡터', () => {
  test('caller=null → FORBIDDEN (크래시 없음)', async () => {
    const videoRepo = new InMemoryVideoRepository();
    const getUC     = new GetVideoUseCase({ videoRepository: videoRepo });
    await assert.rejects(
      () => getUC.execute({ videoId: 'v' }, null),
      err => { assert.equal(err.code, 'FORBIDDEN'); return true; }
    );
  });

  test('caller.permissions=undefined → FORBIDDEN', async () => {
    const videoRepo = new InMemoryVideoRepository();
    const getUC     = new GetVideoUseCase({ videoRepository: videoRepo });
    await assert.rejects(
      () => getUC.execute({ videoId: 'v' }, { userId: 'u' }),
      err => { assert.equal(err.code, 'FORBIDDEN'); return true; }
    );
  });

  test('video:write만으로 archive 시도 → FORBIDDEN (video:admin 필요)', async () => {
    const videoRepo = new InMemoryVideoRepository();
    const archiveUC = new ArchiveVideoUseCase({ videoRepository: videoRepo });
    let v = Video.create({ videoId: 'v', title: 'T', uploaderId: 'u', originalFileRef: 'r' });
    v = v.transitionTo('PROCESSING').transitionTo('READY');
    await videoRepo.save(v);
    await assert.rejects(
      () => archiveUC.execute({ videoId: 'v' }, { permissions: ['video:write'], userId: 'u' }),
      err => { assert.equal(err.code, 'FORBIDDEN'); return true; }
    );
  });

  test('권한 문자열 대소문자 구분: VIDEO:WRITE는 거부', async () => {
    const videoRepo = new InMemoryVideoRepository();
    const uploadUC  = new UploadVideoUseCase({ videoRepository: videoRepo });
    await assert.rejects(
      () => uploadUC.execute({ title: 'T', uploaderId: 'u', originalFileRef: 'r' }, { permissions: ['VIDEO:WRITE'], userId: 'u' }),
      err => { assert.equal(err.code, 'FORBIDDEN'); return true; }
    );
  });
});
