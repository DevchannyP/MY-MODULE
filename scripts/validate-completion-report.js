#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ContractValidator } = require('../src/infrastructure/mpo/ContractValidator');

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').trim();
}

function matchesPattern(relativePath, pattern) {
  const normalizedPath = normalizePath(relativePath);
  const normalizedPattern = normalizePath(pattern);
  if (!normalizedPattern) {
    return false;
  }
  if (normalizedPattern.endsWith('/**')) {
    return normalizedPath.startsWith(normalizedPattern.slice(0, -3));
  }
  return normalizedPath === normalizedPattern;
}

function validateCompletionReport(
  report,
  {
    wp = {},
    commandResults = [],
    root = path.resolve(__dirname, '..'),
    validator = new ContractValidator({ root }),
  } = {},
) {
  validator.validateInput('contracts/harness/output.schema.json', report, 'WPExecutionResult');
  validator.validateInput('contracts/harness/completion-report.schema.json', report, 'CompletionReport');

  const violations = [];
  const allEvidenceObserved = Array.isArray(report.evidence) && report.evidence.length > 0;
  const changedFiles = Array.isArray(report.changed_files) ? report.changed_files.map(normalizePath) : [];

  report.evidence.forEach((entry) => {
    const evidencePath = path.join(root, normalizePath(entry.path));
    if (!fs.existsSync(evidencePath)) {
      violations.push(`missing evidence file: ${entry.path}`);
    }
  });

  changedFiles.forEach((relativePath) => {
    const absolute = path.join(root, relativePath);
    if (!fs.existsSync(absolute)) {
      violations.push(`claimed changed file missing: ${relativePath}`);
    }
    if (Array.isArray(wp.allowed_paths) && wp.allowed_paths.length > 0 && !wp.allowed_paths.some((pattern) => matchesPattern(relativePath, pattern))) {
      violations.push(`changed file outside allowed_paths: ${relativePath}`);
    }
    if (Array.isArray(wp.forbidden_paths) && wp.forbidden_paths.some((pattern) => matchesPattern(relativePath, pattern))) {
      violations.push(`changed file in forbidden_paths: ${relativePath}`);
    }
  });

  if (report.verification_status === 'PASS') {
    const nonPassingVerification = (report.verification || []).filter((entry) => entry.status !== 'PASS');
    if (nonPassingVerification.length > 0) {
      violations.push('PASS claimed but verification bundle contains non-PASS entries');
    }
    if (!allEvidenceObserved) {
      violations.push('PASS claimed but no evidence exists');
    }
  }

  const failedCommands = commandResults.filter((entry) => entry.status !== 'PASS');
  if (report.verification_status === 'PASS' && failedCommands.length > 0) {
    violations.push('PASS claimed but command results contain failures');
  }

  if (report.commit_hash) {
    const verify = spawnSync('git', ['rev-parse', '--verify', report.commit_hash], {
      cwd: root,
      encoding: 'utf8',
    });
    if (verify.status !== 0) {
      violations.push(`commit hash does not exist: ${report.commit_hash}`);
    }
  }

  return {
    verified: violations.length === 0,
    violations,
  };
}

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const result = validateCompletionReport(input.report, input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.verified) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  validateCompletionReport,
  matchesPattern,
};
