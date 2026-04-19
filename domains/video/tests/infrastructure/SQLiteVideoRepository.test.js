'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { SQLiteVideoRepository, SQLiteTranscodeJobRepository } =
  require('../../src/infrastructure/SQLiteVideoRepository');
const { Video }        = require('../../src/domain/Video');
const { TranscodeJob } = require('../../src/domain/TranscodeJob');

const NOW = new Date().toISOString();

function makeVideo(id = 'vid-001', status = 'UPLOADED') {
  return new Video({
    videoId:         id,
    title:           'Test Video',
    uploaderId:      'user-1',
    originalFileRef: 's3://bucket/test.mp4',
    status,
    accessPolicy:    'PRIVATE',
    createdAt:       NOW,
    updatedAt:       NOW,
  });
}

function makeJob(id, videoId, status = 'PENDING') {
  return new TranscodeJob({
    jobId:            id,
    videoId,
    status,
    targetFormat:     'MP4',
    targetResolution: '1080p',
    createdAt:        NOW,
  });
}

// ── SQLiteVideoRepository ─────────────────────────────────────────────────────

test('SQLiteVideoRepository: save → findById 왕복', async () => {
  const repo  = SQLiteVideoRepository.create(':memory:');
  const video = makeVideo();
  await repo.save(video);
  const found = await repo.findById('vid-001');
  assert.ok(found);
  assert.equal(found.videoId,    'vid-001');
  assert.equal(found.uploaderId, 'user-1');
  assert.equal(found.status,     'UPLOADED');
});

test('SQLiteVideoRepository: findById 없으면 null', async () => {
  const repo  = SQLiteVideoRepository.create(':memory:');
  const found = await repo.findById('nonexistent');
  assert.equal(found, null);
});

test('SQLiteVideoRepository: findAll 페이지네이션', async () => {
  const repo = SQLiteVideoRepository.create(':memory:');
  await repo.save(makeVideo('v1', 'UPLOADED'));
  await repo.save(makeVideo('v2', 'UPLOADED'));
  await repo.save(makeVideo('v3', 'READY'));

  const all = await repo.findAll();
  assert.equal(all.total, 3);

  const ready = await repo.findAll({ status: 'READY' });
  assert.equal(ready.total, 1);
  assert.equal(ready.items[0].videoId, 'v3');

  const paged = await repo.findAll({ page: 1, pageSize: 2 });
  assert.equal(paged.items.length, 2);
  assert.equal(paged.page_size, 2);
});

test('SQLiteVideoRepository: upsert — status 갱신', async () => {
  const repo  = SQLiteVideoRepository.create(':memory:');
  const video = makeVideo();
  await repo.save(video);
  const updated = new Video({ ...video, status: 'PROCESSING', updatedAt: new Date().toISOString() });
  await repo.save(updated);
  const found = await repo.findById('vid-001');
  assert.equal(found.status, 'PROCESSING');
});

// ── SQLiteTranscodeJobRepository ──────────────────────────────────────────────

test('SQLiteTranscodeJobRepository: save → findById 왕복', async () => {
  const videoRepo = SQLiteVideoRepository.create(':memory:');
  const jobRepo   = new SQLiteTranscodeJobRepository(videoRepo._db);

  await videoRepo.save(makeVideo('vid-j1'));
  const job = makeJob('job-001', 'vid-j1');
  await jobRepo.save(job);
  const found = await jobRepo.findById('job-001');
  assert.ok(found);
  assert.equal(found.jobId,  'job-001');
  assert.equal(found.status, 'PENDING');
});

test('SQLiteTranscodeJobRepository: findAllByVideoId', async () => {
  const videoRepo = SQLiteVideoRepository.create(':memory:');
  const jobRepo   = new SQLiteTranscodeJobRepository(videoRepo._db);

  await videoRepo.save(makeVideo('vid-j2'));
  await jobRepo.save(makeJob('job-a', 'vid-j2', 'PENDING'));
  await jobRepo.save(makeJob('job-b', 'vid-j2', 'COMPLETED'));

  const jobs = await jobRepo.findAllByVideoId('vid-j2');
  assert.equal(jobs.length, 2);
});

test('SQLiteTranscodeJobRepository: findRunningByVideoId', async () => {
  const videoRepo = SQLiteVideoRepository.create(':memory:');
  const jobRepo   = new SQLiteTranscodeJobRepository(videoRepo._db);

  await videoRepo.save(makeVideo('vid-j3'));
  const running = makeJob('job-run', 'vid-j3', 'RUNNING');
  await jobRepo.save(running);

  const found = await jobRepo.findRunningByVideoId('vid-j3');
  assert.ok(found);
  assert.equal(found.jobId, 'job-run');

  const notFound = await jobRepo.findRunningByVideoId('vid-other');
  assert.equal(notFound, null);
});

test('SQLiteTranscodeJobRepository: INV-V004 — 동일 Video에 RUNNING Job 중복 불가', async () => {
  const videoRepo = SQLiteVideoRepository.create(':memory:');
  const jobRepo   = new SQLiteTranscodeJobRepository(videoRepo._db);

  await videoRepo.save(makeVideo('vid-j4'));
  await jobRepo.save(makeJob('job-r1', 'vid-j4', 'RUNNING'));

  await assert.rejects(
    () => jobRepo.save(makeJob('job-r2', 'vid-j4', 'RUNNING')),
    { code: 'CONFLICT' },
  );
});

test('SQLiteTranscodeJobRepository: RUNNING → COMPLETED upsert (INV-V004 통과)', async () => {
  const videoRepo = SQLiteVideoRepository.create(':memory:');
  const jobRepo   = new SQLiteTranscodeJobRepository(videoRepo._db);

  await videoRepo.save(makeVideo('vid-j5'));
  const job = makeJob('job-upd', 'vid-j5', 'RUNNING');
  await jobRepo.save(job);

  const completed = new TranscodeJob({
    ...job,
    status:             'COMPLETED',
    outputRenditionRef: 's3://bucket/out.mp4',
    completedAt:        new Date().toISOString(),
  });
  await jobRepo.save(completed);

  const found = await jobRepo.findById('job-upd');
  assert.equal(found.status, 'COMPLETED');
  assert.equal(found.outputRenditionRef, 's3://bucket/out.mp4');
});
