'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const SCRIPT = path.resolve(__dirname, '../../../scripts/env-init.js');
const ROOT = path.resolve(__dirname, '../../..');


test('[env-init] --dry-run outputs scaffold without writing file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-init-dry-'));
  fs.mkdirSync(path.join(tmpDir, 'master-shell/feature-flags'), { recursive: true });
  const flagsSrc = path.resolve(ROOT, 'master-shell/feature-flags/flags.yaml');
  fs.copyFileSync(flagsSrc, path.join(tmpDir, 'master-shell/feature-flags/flags.yaml'));
  // .env 미생성 상태 — dry-run이 스캐폴드 미리보기 출력해야 함
  const result = spawnSync(process.execPath, [SCRIPT, '--dry-run'], {
    cwd: tmpDir,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `exit code: ${result.status}\n${result.stderr}`);
  assert.match(result.stdout, /WOS_FLAG_/);
  assert.match(result.stdout, /dry-run/);
  // dry-run이므로 .env 파일이 생성되지 않아야 함
  assert.equal(fs.existsSync(path.join(tmpDir, '.env')), false, 'dry-run은 .env를 생성하면 안 됨');
  fs.rmSync(tmpDir, { recursive: true });
});

test('[env-init] generates .env scaffold in empty temp directory', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-init-gen-'));
  // flags.yaml, .env.example, package.json을 tmpDir로 복사
  const flagsSrc = path.resolve(ROOT, 'master-shell/feature-flags/flags.yaml');
  fs.mkdirSync(path.join(tmpDir, 'master-shell/feature-flags'), { recursive: true });
  fs.copyFileSync(flagsSrc, path.join(tmpDir, 'master-shell/feature-flags/flags.yaml'));

  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: tmpDir,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `exit code: ${result.status}\n${result.stderr}`);

  const envFile = fs.readFileSync(path.join(tmpDir, '.env'), 'utf8');

  // 필수 WOS_FLAG_* 라인 존재 확인
  assert.match(envFile, /WOS_FLAG_ENABLE_TASK_MANAGEMENT=true/);
  assert.match(envFile, /WOS_FLAG_BILLING_ENABLED=true/);
  assert.match(envFile, /WOS_FLAG_VIDEO_ENABLED=true/);
  assert.match(envFile, /WOS_FLAG_ENABLE_DEBUG_MODE=true/);
  // PORT/HOST 기본값 포함
  assert.match(envFile, /PORT=3000/);
  assert.match(envFile, /HOST=127\.0\.0\.1/);
  // 모두 주석 처리됨 — 활성 WOS_FLAG_* 없어야 함
  const activeFlags = envFile.split('\n').filter((l) => /^WOS_FLAG_/.test(l));
  assert.equal(activeFlags.length, 0, `기본 생성 시 활성 WOS_FLAG_* 없어야 함: ${activeFlags}`);

  fs.rmSync(tmpDir, { recursive: true });
});

test('[env-init] preserves existing active settings on incremental add', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-init-merge-'));
  fs.mkdirSync(path.join(tmpDir, 'master-shell/feature-flags'), { recursive: true });
  const flagsSrc = path.resolve(ROOT, 'master-shell/feature-flags/flags.yaml');
  fs.copyFileSync(flagsSrc, path.join(tmpDir, 'master-shell/feature-flags/flags.yaml'));

  // 기존 .env에 활성 플래그 1개 설정
  fs.writeFileSync(path.join(tmpDir, '.env'), [
    'PORT=4000',
    'WOS_FLAG_ENABLE_TASK_MANAGEMENT=true',
    '',
  ].join('\n'), 'utf8');

  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: tmpDir,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `exit code: ${result.status}\n${result.stderr}`);

  const envFile = fs.readFileSync(path.join(tmpDir, '.env'), 'utf8');

  // 기존 활성 설정 보존
  assert.match(envFile, /^WOS_FLAG_ENABLE_TASK_MANAGEMENT=true/m, '기존 활성 플래그가 보존되어야 함');
  assert.match(envFile, /PORT=4000/, '기존 PORT 설정 보존');
  // 누락된 플래그가 추가됨
  assert.match(envFile, /WOS_FLAG_BILLING_ENABLED/, '누락된 플래그가 추가되어야 함');

  fs.rmSync(tmpDir, { recursive: true });
});

test('[env-init] groups flags into released/internal sections when metadata.json is present', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-init-meta-'));
  fs.mkdirSync(path.join(tmpDir, 'master-shell/feature-flags'), { recursive: true });
  const flagsSrc = path.resolve(ROOT, 'master-shell/feature-flags/flags.yaml');
  const metaSrc = path.resolve(ROOT, 'master-shell/feature-flags/metadata.json');
  fs.copyFileSync(flagsSrc, path.join(tmpDir, 'master-shell/feature-flags/flags.yaml'));
  fs.copyFileSync(metaSrc, path.join(tmpDir, 'master-shell/feature-flags/metadata.json'));

  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: tmpDir,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `exit code: ${result.status}\n${result.stderr}`);

  const envFile = fs.readFileSync(path.join(tmpDir, '.env'), 'utf8');

  // released 섹션 헤더가 있어야 함
  assert.match(envFile, /released 단계 플래그/, 'released 섹션 헤더 존재');
  // internal 섹션 헤더가 있어야 함
  assert.match(envFile, /internal 단계 플래그/, 'internal 섹션 헤더 존재');

  // released 플래그가 released 섹션에 포함되어야 함
  const releasedIdx = envFile.indexOf('released 단계 플래그');
  const internalIdx = envFile.indexOf('internal 단계 플래그');
  assert.ok(releasedIdx < internalIdx, 'released 섹션이 internal 섹션보다 먼저 나와야 함');

  const taskMgmtIdx = envFile.indexOf('WOS_FLAG_ENABLE_TASK_MANAGEMENT');
  assert.ok(taskMgmtIdx > releasedIdx && taskMgmtIdx < internalIdx,
    'WOS_FLAG_ENABLE_TASK_MANAGEMENT이 released 섹션에 있어야 함');

  // internal 플래그가 internal 섹션에 포함되어야 함
  const debugIdx = envFile.indexOf('WOS_FLAG_ENABLE_DEBUG_MODE');
  assert.ok(debugIdx > internalIdx, 'WOS_FLAG_ENABLE_DEBUG_MODE이 internal 섹션에 있어야 함');

  // env:status 힌트가 헤더에 있어야 함
  assert.match(envFile, /env:status/, 'env:status 힌트가 헤더에 존재');

  fs.rmSync(tmpDir, { recursive: true });
});

test('[env-init] --force rewrites .env and creates .env.bak', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-init-force-'));
  fs.mkdirSync(path.join(tmpDir, 'master-shell/feature-flags'), { recursive: true });
  const flagsSrc = path.resolve(ROOT, 'master-shell/feature-flags/flags.yaml');
  fs.copyFileSync(flagsSrc, path.join(tmpDir, 'master-shell/feature-flags/flags.yaml'));

  // 기존 .env에 커스텀 내용
  fs.writeFileSync(path.join(tmpDir, '.env'), 'MY_CUSTOM=value\n', 'utf8');

  const result = spawnSync(process.execPath, [SCRIPT, '--force'], {
    cwd: tmpDir,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `exit code: ${result.status}\n${result.stderr}`);

  // .env.bak에 기존 내용 백업됨
  const bak = fs.readFileSync(path.join(tmpDir, '.env.bak'), 'utf8');
  assert.match(bak, /MY_CUSTOM=value/, '.env.bak에 기존 내용이 있어야 함');

  // .env가 새 스캐폴드로 교체됨
  const envFile = fs.readFileSync(path.join(tmpDir, '.env'), 'utf8');
  assert.match(envFile, /WOS_FLAG_ENABLE_TASK_MANAGEMENT=true/);
  assert.doesNotMatch(envFile, /MY_CUSTOM=value/, '기존 커스텀 내용이 .env에 없어야 함');

  fs.rmSync(tmpDir, { recursive: true });
});
