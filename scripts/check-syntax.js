'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOTS = ['src', 'domains', 'scripts'];
const IGNORED_DIRS = new Set(['node_modules', '.git']);

function collectJavaScriptFiles(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return [];
  }

  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return targetPath.endsWith('.js') ? [targetPath] : [];
  }

  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  return entries.flatMap((entry) => {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        return [];
      }

      return collectJavaScriptFiles(path.join(targetPath, entry.name));
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      return [path.join(targetPath, entry.name)];
    }

    return [];
  });
}

const files = ROOTS.flatMap((root) => collectJavaScriptFiles(root)).sort();

if (files.length === 0) {
  process.stdout.write('syntax check: no JavaScript files found\n');
  process.exit(0);
}

const result = spawnSync(process.execPath, ['--check', ...files], { stdio: 'inherit' });

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
