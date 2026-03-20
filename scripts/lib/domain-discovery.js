'use strict';

const fs = require('node:fs');
const path = require('node:path');

function collectDomainEntries(domainsDir) {
  const entries = [];

  function visit(currentDir) {
    if (!fs.existsSync(currentDir)) return;

    const dirents = fs.readdirSync(currentDir, { withFileTypes: true });
    const names = new Set(dirents.map((dirent) => dirent.name));
    const hasContracts = names.has('contracts') || names.has('contract');
    const hasSrc = names.has('src');
    const hasSpec = names.has('domain-spec.md');

    if (currentDir !== domainsDir && (hasContracts || hasSrc || hasSpec)) {
      const id = path.relative(domainsDir, currentDir).split(path.sep).join('/');
      entries.push({
        id,
        dir: currentDir,
        contractsDir: names.has('contracts') ? path.join(currentDir, 'contracts') : names.has('contract') ? path.join(currentDir, 'contract') : null,
        srcDir: hasSrc ? path.join(currentDir, 'src') : null,
        testsDir: names.has('tests') ? path.join(currentDir, 'tests') : null,
        specFile: hasSpec ? path.join(currentDir, 'domain-spec.md') : null,
      });
      return;
    }

    dirents
      .filter((dirent) => dirent.isDirectory())
      .forEach((dirent) => visit(path.join(currentDir, dirent.name)));
  }

  visit(domainsDir);
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

function resolveDomainEntry(domainsDir, targetId) {
  return collectDomainEntries(domainsDir).find((entry) => entry.id === targetId) || null;
}

module.exports = {
  collectDomainEntries,
  resolveDomainEntry,
};
