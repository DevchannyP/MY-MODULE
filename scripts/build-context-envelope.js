#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ContractValidator, readYaml } = require('../src/infrastructure/mpo/ContractValidator');
const { estimateTokens } = require('../src/infrastructure/ai/NullHarnessProvider');

function walkFiles(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return [];
  }
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return [targetPath];
  }
  const entries = [];
  for (const child of fs.readdirSync(targetPath)) {
    entries.push(...walkFiles(path.join(targetPath, child)));
  }
  return entries;
}

function patternToFiles(root, pattern) {
  const normalized = String(pattern || '').replace(/\\/g, '/');
  if (!normalized) {
    return [];
  }
  if (normalized.endsWith('/**')) {
    return walkFiles(path.join(root, normalized.slice(0, -3)));
  }
  return fs.existsSync(path.join(root, normalized)) ? [path.join(root, normalized)] : [];
}

function lineRangeForFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const total = fs.readFileSync(filePath, 'utf8').split('\n').length;
  return {
    path: path.relative(path.resolve(__dirname, '..'), filePath).replace(/\\/g, '/'),
    line_start: 1,
    line_end: total,
  };
}

function isClassifiedAs(relPath, patterns) {
  return patterns.some((pattern) => {
    const normalized = String(pattern || '').replace(/\\/g, '/');
    if (normalized.endsWith('/**')) {
      return relPath.startsWith(normalized.slice(0, -3));
    }
    if (normalized.startsWith('**/') || normalized.includes('*')) {
      const suffix = normalized.replace(/^\*\*\//, '');
      return relPath.endsWith(suffix);
    }
    return relPath === normalized;
  });
}

function buildEnvelopeForWp(root, wp, classification) {
  const generatedPatterns = (classification.generated || []).map((p) => String(p || '').replace(/\\/g, '/'));
  const forbiddenPatterns = (classification.forbidden || []).map((p) => String(p || '').replace(/\\/g, '/'));

  function isExcluded(relPath) {
    return isClassifiedAs(relPath, generatedPatterns) || isClassifiedAs(relPath, forbiddenPatterns);
  }

  const canonicalFiles = new Set();
  const partialFiles = [];

  (classification.canonical || []).forEach((entry) => {
    const absolute = path.join(root, entry);
    const relPath = path.relative(root, absolute).replace(/\\/g, '/');
    if (fs.existsSync(absolute) && !isExcluded(relPath)) {
      canonicalFiles.add(relPath);
    }
  });

  (wp.allowed_paths || []).forEach((pattern) => {
    patternToFiles(root, pattern).slice(0, 8).forEach((filePath) => {
      const relPath = path.relative(root, filePath).replace(/\\/g, '/');
      if (!isExcluded(relPath)) {
        canonicalFiles.add(relPath);
      }
    });
  });

  if (wp.domain && wp.domain !== 'mpo' && wp.domain !== 'docs' && wp.domain !== 'server') {
    [
      `requirements/${wp.domain}.yaml`,
      `memory/stageA/${wp.domain}.yaml`,
      `domains/${wp.domain}/contract/capability.yaml`,
      `domains/${wp.domain}/contracts/capability.yaml`,
    ].forEach((relativePath) => {
      const absolute = path.join(root, relativePath);
      const range = lineRangeForFile(absolute);
      if (range) {
        partialFiles.push(range);
      }
    });
  } else {
    [
      'requirements/harness-engineering.yaml',
      'requirements/validation-profiles.yaml',
      'requirements/constraints.yaml',
    ].forEach((relativePath) => {
      const absolute = path.join(root, relativePath);
      const range = lineRangeForFile(absolute);
      if (range) {
        partialFiles.push(range);
      }
    });
  }

  const canonicalList = Array.from(canonicalFiles).slice(0, 16);
  const estimatedContextTokens = canonicalList.reduce((total, relativePath) => {
    const absolute = path.join(root, relativePath);
    return total + estimateTokens(fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : '');
  }, 0);

  return {
    canonical_files: canonicalList,
    partial_files: partialFiles.slice(0, 8),
    estimated_context_tokens: estimatedContextTokens,
  };
}

function buildContextEnvelope(dag, { root = path.resolve(__dirname, '..'), validator = new ContractValidator({ root }) } = {}) {
  validator.validateInput('contracts/harness/wp-dag.schema.json', dag, 'WPDagWithBoundaries');
  const sourceDoc = readYaml(path.join(root, 'contracts/harness/context-sources.yaml'));
  const classification = sourceDoc.classification || {};
  const nextDag = {
    ...dag,
    wp_list: dag.wp_list.map((wp) => ({
      ...wp,
      context_envelope: buildEnvelopeForWp(root, wp, classification),
    })),
  };
  return validator.validateOutput('contracts/harness/wp-dag.schema.json', nextDag, 'WPDagWithEnvelopes');
}

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const output = buildContextEnvelope(input);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildContextEnvelope,
};
