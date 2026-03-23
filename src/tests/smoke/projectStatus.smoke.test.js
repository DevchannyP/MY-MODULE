'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildReport } = require('../../../scripts/project_status');

test('[project status smoke] next_wp는 canonical wp-queue 기준으로 계산된다', async () => {
  const report = buildReport();
  assert.equal(report.current_wp, 'WP-RUN-004');
  assert.equal(report.next_wp, 'NONE');
});
