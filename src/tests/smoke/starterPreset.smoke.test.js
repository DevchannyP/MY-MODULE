'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[starter preset] goal-specific planning/routing/template preset is generated', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/generate_starter_preset.py', '--goal', 'plan-and-learn', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(report.goal, 'plan-and-learn');
  assert.equal(report.planning_mode.id, 'master-prd');
  assert.equal(report.routing_profile.id, 'plan-and-learn-routing');
  assert.equal(report.execution_template_id, 'planner-implementation');
  assert.ok(Array.isArray(report.recommended_focus_ids));
  assert.ok(Array.isArray(report.planning_sections));
  assert.ok(report.planning_sections.some((item) => item.id === 'problem'));
});
