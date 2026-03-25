'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[context bundle export] current-wp and routing profile become a minimal read bundle', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfos-context-'));
  const currentWpPath = path.join(tempDir, 'current-wp.yaml');

  fs.writeFileSync(currentWpPath, `id: "WP-CONTEXT-001"
goal: "module extension context bundle을 내보낸다"
type: "domain"
stage: "D"
scope_out:
  - "system OS core"
  - "domains/"
context_budget:
  tier_reads:
    - "requirements/requirements.yaml"
    - "worklog/contract-matrix.md"
  context_reads:
    - "master-shell/catalog/adapter-registry.yaml"
`, 'utf8');

  const { stdout } = await execFileAsync('python3', [
    'scripts/export_context_bundle.py',
    '--goal', 'module-extension',
    '--json',
    '--current-wp-path', currentWpPath,
  ], {
    cwd: path.resolve(__dirname, '../../..'),
  });

  const report = JSON.parse(stdout);
  assert.equal(report.goal, 'module-extension');
  assert.equal(report.profile_id, 'module-extension-routing');
  assert.match(report.current_wp.id, /WP-CONTEXT-001/);
  assert.ok(report.read_first.includes('requirements/requirements.yaml'));
  assert.ok(report.read_next.includes('master-shell/catalog/adapter-registry.yaml'));
  assert.ok(report.protected_core.includes('system OS core'));
  assert.equal(typeof report.budget.total_estimated_tokens, 'number');
  assert.ok(report.budget.total_estimated_tokens >= 1);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
