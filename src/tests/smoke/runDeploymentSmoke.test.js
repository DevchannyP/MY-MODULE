'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, createAllEnabledFlags } = require('../../server/createServer');

const execFileAsync = promisify(execFile);

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

test('[deployment smoke runner] executes the deployed-environment checklist and writes an artifact', async () => {
  const runtime = await startServer({ port: 0, flags: createAllEnabledFlags() });
  const outputPath = path.join(os.tmpdir(), `deployment-smoke-${Date.now()}.json`);

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      'scripts/run_deployment_smoke.js',
      '--base-url', runtime.url,
      '--task-write-permissions', 'task:read,task:write',
      '--task-read-permissions', 'task:read',
      '--output', outputPath,
    ], {
      cwd: path.resolve(__dirname, '../../..'),
    });

    assert.match(stdout, /Deployment smoke PASS/);
    assert.equal(stderr, '');

    const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(report.overall_status, 'PASS');
    assert.equal(report.steps.find((step) => step.id === 'health').status, 'PASS');
    assert.equal(report.steps.find((step) => step.id === 'task-create').status, 'PASS');
    assert.equal(report.steps.find((step) => step.id === 'task-read').status, 'PASS');
    assert.equal(report.steps.find((step) => step.id === 'billing-permission-denied').status, 'PASS');
    assert.equal(report.steps.find((step) => step.id === 'flag-off-route').status, 'SKIPPED');
    assert.ok(Array.isArray(report.pending_manual_checks));
  } finally {
    fs.rmSync(outputPath, { force: true });
    await closeServer(runtime.server);
  }
});
