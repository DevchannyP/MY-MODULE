#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ContractValidator } = require('../src/infrastructure/mpo/ContractValidator');

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function isAbsoluteOrTraversalPath(value) {
  const raw = String(value || '').replace(/\\/g, '/').trim();
  return raw.startsWith('/') || raw === '..' || raw.startsWith('../') || raw.includes('/../');
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

function contextEnvelopePaths(wp = {}) {
  const canonical = Array.isArray(wp.context_envelope?.canonical_files)
    ? wp.context_envelope.canonical_files
    : [];
  const partial = Array.isArray(wp.context_envelope?.partial_files)
    ? wp.context_envelope.partial_files.map((entry) => entry && entry.path)
    : [];
  return canonical.concat(partial).map(normalizePath).filter(Boolean);
}

function isPathInPatterns(relativePath, patterns = []) {
  return Array.isArray(patterns) && patterns.some((pattern) => matchesPattern(relativePath, pattern));
}

function isReadAllowedByEnvelope(relativePath, wp = {}) {
  const envelopePaths = contextEnvelopePaths(wp);
  if (envelopePaths.length === 0) {
    return true;
  }
  return envelopePaths.some((entry) => normalizePath(entry) === normalizePath(relativePath));
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
  const rawReadFiles = Array.isArray(report.read_files) ? report.read_files : [];
  const readFileSet = new Set();

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
    if (Array.isArray(wp.allowed_paths) && wp.allowed_paths.length > 0 && !isPathInPatterns(relativePath, wp.allowed_paths)) {
      violations.push(`changed file outside allowed_paths: ${relativePath}`);
    }
    if (isPathInPatterns(relativePath, wp.forbidden_paths)) {
      violations.push(`changed file in forbidden_paths: ${relativePath}`);
    }
  });

  rawReadFiles.forEach((raw) => {
    const relativePath = normalizePath(raw);
    if (!relativePath) {
      violations.push('read file path is empty');
      return;
    }
    if (isAbsoluteOrTraversalPath(raw)) {
      violations.push(`read file path is absolute or contains traversal: ${raw}`);
      return;
    }
    if (readFileSet.has(relativePath)) {
      violations.push(`duplicate read file path: ${relativePath}`);
    }
    readFileSet.add(relativePath);
    const absolute = path.join(root, relativePath);
    if (!fs.existsSync(absolute)) {
      violations.push(`claimed read file missing: ${relativePath}`);
    }
    if (!isReadAllowedByEnvelope(relativePath, wp)) {
      violations.push(`read file outside context_envelope: ${relativePath}`);
    }
    if (isPathInPatterns(relativePath, wp.forbidden_paths)) {
      violations.push(`read file in forbidden_paths: ${relativePath}`);
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
    if (!Array.isArray(report.tests_run) || report.tests_run.length === 0) {
      violations.push('PASS claimed but tests_run is empty or missing');
    }
  }

  const invalidTestsRun = (report.tests_run || []).filter(
    (t) => t.status === 'NOT_RUN' || t.status === 'PLANNED',
  );
  if (invalidTestsRun.length > 0) {
    violations.push('tests_run must not contain NOT_RUN or PLANNED status — use tests_planned instead');
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

function validateCompletionReportInput(input = {}) {
  const options = {
    ...input,
  };
  if (input.root) {
    options.validator = new ContractValidator({ root: input.root });
  }
  return validateCompletionReport(input.report, options);
}

function main() {
  const inputArgIndex = process.argv.indexOf('--input');
  const inputText = inputArgIndex >= 0 && process.argv[inputArgIndex + 1]
    ? fs.readFileSync(process.argv[inputArgIndex + 1], 'utf8')
    : fs.readFileSync(0, 'utf8');
  const input = JSON.parse(inputText || '{}');
  try {
    const result = validateCompletionReportInput(input);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.verified) {
      process.exitCode = 1;
    }
  } catch (err) {
    process.stdout.write(`${JSON.stringify({ verified: false, violations: [String(err.message || err)] }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  validateCompletionReport,
  validateCompletionReportInput,
  matchesPattern,
  contextEnvelopePaths,
  isReadAllowedByEnvelope,
  normalizePath,
  isAbsoluteOrTraversalPath,
};
