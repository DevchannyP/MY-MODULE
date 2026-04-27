'use strict';

const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const EXPECTED_DOMAINS = ['billing', 'productivity/task-tracking', 'video'];

test('[architecture fitness smoke] boundary guardrails pass for current domains', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { runArchitectureFitness } = require(path.join(repoRoot, 'scripts/architecture-fitness.js'));
  const { totalFails, domainCount, output: stdout, missingTarget } = runArchitectureFitness();

  assert.equal(missingTarget, false);
  assert.equal(totalFails, 0, stdout);

  // 위반 건수 0 확인
  const totalMatch = stdout.match(/위반:\s*(\d+)건/);
  assert.ok(totalMatch, `총계 줄 missing in stdout: ${stdout}`);
  assert.equal(Number(totalMatch[1]), 0, `architecture violations found: ${stdout}`);

  // 검사된 도메인 수 확인
  const domainMatch = stdout.match(/총\s*(\d+)개 도메인/);
  assert.ok(domainMatch, `도메인 수 줄 missing in stdout: ${stdout}`);
  assert.ok(
    domainCount >= EXPECTED_DOMAINS.length,
    `expected at least ${EXPECTED_DOMAINS.length} domains, got ${domainCount}`,
  );

  // 각 도메인이 PASS로 마킹됐는지 확인
  for (const domain of EXPECTED_DOMAINS) {
    assert.ok(
      stdout.includes(domain) && stdout.includes('✅ PASS'),
      `domain [${domain}] not found as PASS in output`,
    );
  }
});
