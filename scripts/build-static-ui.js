#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const steps = [
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
  {
    label: '마인드맵 컨트롤 센터',
    command: 'node',
    args: ['scripts/generate-mindmap.js'],
  },
];

function runStep(step) {
  return new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        if (stdout) {
          process.stdout.write(stdout);
        }
        if (stderr) {
          process.stderr.write(stderr);
        }
        reject(new Error(`${step.label} 생성 실패`));
        return;
      }
      process.stdout.write(`[ui:build] ${step.label} 생성 완료\n`);
      resolve();
    });
  });
}

Promise.all(steps.map((step) => runStep(step))).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
