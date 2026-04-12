'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolveValidationProfile } = require('../../../scripts/resolve_validation_profile');

test('[validation profiles smoke] packet type and stage resolve to a stable minimum command bundle', async () => {
  const governanceProfile = resolveValidationProfile({
    type: 'governance',
    stage: 'E',
    validation: ['npm run wp:reconcile'],
  });

  assert.equal(governanceProfile.packet_type, 'governance');
  assert.equal(governanceProfile.requested_packet_type, 'governance');
  assert.equal(governanceProfile.stage, 'E');
  assert.ok(governanceProfile.commands.includes('npm run validate:requirements'));
  assert.ok(governanceProfile.commands.includes('npm run lint'));
  assert.ok(governanceProfile.commands.includes('npm run validate:composition'));
  assert.ok(governanceProfile.commands.includes('npm run check:branch-protection-policy'));
  assert.ok(governanceProfile.commands.includes('npm run check:deployment-environment-provisioning'));
  assert.ok(governanceProfile.commands.includes('npm run test:e2e-smoke'));
  assert.ok(governanceProfile.commands.includes('npm run wp:reconcile'));
  assert.ok(Array.isArray(governanceProfile.focus_tags));
  assert.ok(governanceProfile.focus_tags.includes('ci'));
  assert.ok(Array.isArray(governanceProfile.success_criteria));
  assert.equal(typeof governanceProfile.primary_command, 'string');
  assert.equal(new Set(governanceProfile.commands).size, governanceProfile.commands.length);

  const domainProfile = resolveValidationProfile({
    type: 'domain',
    stage: 'D',
    validation: ['npm run test:authn-authz'],
  });

  assert.equal(domainProfile.packet_type, 'domain');
  assert.ok(domainProfile.commands.includes('npm run test:contract'));
  assert.ok(domainProfile.commands.includes('npm test'));
  assert.ok(domainProfile.commands.includes('npm run test:integration'));
  assert.ok(domainProfile.commands.includes('npm run test:e2e-smoke'));
  assert.ok(domainProfile.commands.includes('npm run test:authn-authz'));
  assert.ok(domainProfile.commands.includes('npm run lint'));

  const aliasProfile = resolveValidationProfile({
    type: 'bugfix',
    stage: 'D',
  });

  assert.equal(aliasProfile.requested_packet_type, 'bugfix');
  assert.equal(aliasProfile.packet_type, 'domain');
  assert.equal(aliasProfile.resolved_from_alias, true);
  assert.ok(aliasProfile.commands.includes('npm run test:integration'));
});
