#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const steps = [
  {
    label: '마스터 플래너',
    command: 'python3',
    args: ['scripts/generate-master-planner.py', '--silent'],
  },
  {
    label: '도메인 카탈로그',
    command: 'node',
    args: ['scripts/generate-catalog-site.js'],
  },
  {
    label: '학습 가이드',
    command: 'node',
    args: ['scripts/generate-study-guide.js'],
  },
  {
    label: '루트 홈',
    command: 'node',
    args: ['scripts/generate-ui-home.js'],
  },
];

steps.forEach((step) => {
  const result = spawnSync(step.command, step.args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    throw new Error(`${step.label} 생성 실패`);
  }

  process.stdout.write(`[ui:build] ${step.label} 생성 완료\n`);
});
