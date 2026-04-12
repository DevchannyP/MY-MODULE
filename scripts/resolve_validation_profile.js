'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PROFILE_PATH = 'requirements/validation-profiles.yaml';

function readYaml(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return {};
  }

  const script = [
    'import json, pathlib, sys, yaml',
    'path = pathlib.Path(sys.argv[1])',
    'data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}',
    'print(json.dumps(data, ensure_ascii=False))',
  ].join('; ');

  const result = spawnSync('python3', ['-c', script, absolutePath], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return {};
  }
  return JSON.parse(result.stdout || '{}');
}

function ensureList(value) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function normalizePacketType(packetType, aliases = {}) {
  const requested = String(packetType || 'planning').trim().toLowerCase() || 'planning';
  const canonical = String(aliases[requested] || requested).trim().toLowerCase() || 'planning';
  return {
    requested,
    canonical,
    used_alias: canonical !== requested,
  };
}

function resolveValidationProfile(currentWp = {}, options = {}) {
  const profileDoc = readYaml(PROFILE_PATH);
  const normalizedPacketType = normalizePacketType(options.packetType || currentWp.type || 'planning', profileDoc.aliases || {});
  const stage = String(options.stage || currentWp.stage || '').trim().toUpperCase();
  const defaults = ensureList(profileDoc.defaults?.commands);
  const profiles = profileDoc.profiles || {};
  const profile = profiles[normalizedPacketType.canonical] || profiles.planning || {};
  const profileCommands = ensureList(profile.commands);
  const packetCommands = ensureList(currentWp.validation);
  const stageAdds = ensureList(profileDoc.stage_overrides?.[stage]?.add);
  const commands = unique([...defaults, ...profileCommands, ...stageAdds, ...packetCommands]);

  return {
    path: PROFILE_PATH,
    requested_packet_type: normalizedPacketType.requested,
    packet_type: normalizedPacketType.canonical,
    canonical_packet_type: normalizedPacketType.canonical,
    resolved_from_alias: normalizedPacketType.used_alias,
    stage,
    description: String(profile.description || profileDoc.defaults?.description || ''),
    focus_tags: ensureList(profile.focus_tags),
    success_criteria: ensureList(profile.success_criteria),
    primary_command: commands[0] || '',
    commands,
    source_breakdown: {
      defaults,
      profile: profileCommands,
      stage_overrides: stageAdds,
      packet_validation: packetCommands,
    },
  };
}

function main() {
  const asJson = process.argv.includes('--json');
  const currentWp = readYaml('memory/current-wp.yaml');
  const summary = resolveValidationProfile(currentWp);

  if (asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  const lines = [
    '=== Validation Profile ===',
    `Type        : ${summary.packet_type}`,
    `Requested   : ${summary.requested_packet_type}`,
    `Stage       : ${summary.stage || 'UNKNOWN'}`,
    `Description : ${summary.description || 'n/a'}`,
    '',
    '[Focus Tags]',
    ...summary.focus_tags.map((tag) => `- ${tag}`),
    '',
    '[Commands]',
    ...summary.commands.map((command) => `- ${command}`),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  resolveValidationProfile,
};
