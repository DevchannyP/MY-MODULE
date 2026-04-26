'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const RAW_INTENT_SCHEMA_PATH = path.join(ROOT, 'contracts', 'harness', 'raw-intent.schema.json');
const INTAKE_SCHEMA_PATH = path.join(ROOT, 'contracts', 'harness', 'intake.schema.json');
const EXECUTION_PACKET_SCHEMA_PATH = path.join(ROOT, 'contracts', 'harness', 'execution-packet.schema.json');
const WP_DAG_SCHEMA_PATH = path.join(ROOT, 'contracts', 'harness', 'wp-dag.schema.json');
const OUTPUT_SCHEMA_PATH = path.join(ROOT, 'contracts', 'harness', 'output.schema.json');
const COMPLETION_REPORT_SCHEMA_PATH = path.join(ROOT, 'contracts', 'harness', 'completion-report.schema.json');
const PROVIDER_ADAPTER_PATH = path.join(ROOT, 'contracts', 'harness', 'provider-adapter.yaml');
const GOLDEN_SET_PATH = path.join(ROOT, 'evals', 'golden', 'harness-core.jsonl');
const HARNESS_CONTRACT_PATH = path.join(ROOT, 'requirements', 'harness-engineering.yaml');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readYaml(filePath) {
  const script = [
    'import json, pathlib, sys, yaml',
    'path = pathlib.Path(sys.argv[1])',
    'data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}',
    'print(json.dumps(data, ensure_ascii=False))',
  ].join('; ');
  const result = spawnSync('python3', ['-c', script, filePath], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    fail(`harness contract validation FAIL: unable to read yaml ${path.relative(ROOT, filePath)}`);
  }

  return JSON.parse(result.stdout || '{}');
}

function requireFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`harness contract validation FAIL: missing ${path.relative(ROOT, filePath)}`);
  }
}

function requireRequiredFields(schema, expected, label) {
  const required = Array.isArray(schema.required) ? schema.required : [];
  expected.forEach((field) => {
    if (!required.includes(field)) {
      fail(`harness contract validation FAIL: ${label} missing required field ${field}`);
    }
  });
}

function requireEnum(schema, propertyName, expected, label) {
  const values = schema?.properties?.[propertyName]?.enum;
  if (!Array.isArray(values)) {
    fail(`harness contract validation FAIL: ${label}.${propertyName} enum missing`);
  }

  expected.forEach((value) => {
    if (!values.includes(value)) {
      fail(`harness contract validation FAIL: ${label}.${propertyName} missing enum value ${value}`);
    }
  });
}

function requireArrayOfStrings(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    fail(`harness contract validation FAIL: ${label} must be a non-empty string array`);
  }
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`harness contract validation FAIL: ${label} must be a non-empty string`);
  }
}

function validateHarnessYaml(contractDoc) {
  const metadataFields = contractDoc?.deliverable_contract?.metadata_fields;
  requireArrayOfStrings(metadataFields, 'deliverable_contract.metadata_fields');

  const expectedMetadata = ['prompt_version', 'mode', 'risk_level', 'evidence_status', 'output_contract'];
  expectedMetadata.forEach((field) => {
    if (!metadataFields.includes(field)) {
      fail(`harness contract validation FAIL: deliverable_contract.metadata_fields missing ${field}`);
    }
  });

  const outputSchemaRef = String(contractDoc?.deliverable_contract?.output_schema_ref || '').trim();
  if (outputSchemaRef !== 'contracts/harness/output.schema.json') {
    fail('harness contract validation FAIL: deliverable_contract.output_schema_ref must point to contracts/harness/output.schema.json');
  }

  const modeRouter = contractDoc?.mode_router?.modes || {};
  ['Research', 'Build', 'Debug', 'Operate', 'Policy'].forEach((modeName) => {
    if (!modeRouter[modeName]) {
      fail(`harness contract validation FAIL: mode_router missing ${modeName}`);
    }
  });

  const providerContract = contractDoc?.provider_adapter_contract || {};
  const expectedRefs = {
    contract_ref: 'contracts/harness/provider-adapter.yaml',
    stage_a_memory_ref: 'memory/stageA/harness-provider-adapter.yaml',
    stage_b_memory_ref: 'memory/stageB/harness-provider-adapter.yaml',
    adr_ref: 'docs/adr/0013-harness-provider-adapter-strategy.md',
    known_issue_ref: 'KI-HARNESS-001',
  };
  Object.entries(expectedRefs).forEach(([field, expected]) => {
    if (String(providerContract[field] || '').trim() !== expected) {
      fail(`harness contract validation FAIL: provider_adapter_contract.${field} must be ${expected}`);
    }
  });
}

function validateProviderAdapterYaml(providerDoc) {
  requireString(providerDoc?.contract_id, 'provider-adapter.contract_id');
  requireString(providerDoc?.objective, 'provider-adapter.objective');
  requireArrayOfStrings(providerDoc?.non_goals, 'provider-adapter.non_goals');
  requireArrayOfStrings(providerDoc?.constraints, 'provider-adapter.constraints');
  requireArrayOfStrings(providerDoc?.assumptions, 'provider-adapter.assumptions');

  if (String(providerDoc.contract_id) !== 'harness-provider-adapter') {
    fail('harness contract validation FAIL: provider-adapter.contract_id must be harness-provider-adapter');
  }

  if (String(providerDoc?.output_contract?.schema_ref || '').trim() !== 'contracts/harness/output.schema.json') {
    fail('harness contract validation FAIL: provider-adapter.output_contract.schema_ref must point to contracts/harness/output.schema.json');
  }

  if (String(providerDoc?.routing_policy?.source_of_truth || '').trim() !== 'src/infrastructure/HarnessRuntimeRouter.js') {
    fail('harness contract validation FAIL: provider-adapter.routing_policy.source_of_truth must point to src/infrastructure/HarnessRuntimeRouter.js');
  }

  const providerProfiles = Array.isArray(providerDoc?.provider_profiles) ? providerDoc.provider_profiles : [];
  const providerIds = providerProfiles.map((profile) => String(profile?.id || ''));
  ['null-harness-provider', 'openai-responses'].forEach((providerId) => {
    if (!providerIds.includes(providerId)) {
      fail(`harness contract validation FAIL: provider-adapter.provider_profiles missing ${providerId}`);
    }
  });

  const failureModel = Array.isArray(providerDoc?.failure_model) ? providerDoc.failure_model : [];
  const failureCodes = failureModel.map((entry) => String(entry?.code || ''));
  [
    'PROVIDER_NOT_CONFIGURED',
    'PROVIDER_TIMEOUT',
    'PROVIDER_RATE_LIMITED',
    'PROVIDER_AUTH_FAILED',
    'PROVIDER_SCHEMA_MISMATCH',
    'PROVIDER_BUDGET_EXCEEDED',
    'PROVIDER_UNAVAILABLE',
  ].forEach((code) => {
    if (!failureCodes.includes(code)) {
      fail(`harness contract validation FAIL: provider-adapter.failure_model missing ${code}`);
    }
  });

  requireArrayOfStrings(providerDoc?.observability?.spans, 'provider-adapter.observability.spans');
  requireArrayOfStrings(providerDoc?.observability?.metrics, 'provider-adapter.observability.metrics');
  requireArrayOfStrings(providerDoc?.observability?.log_fields, 'provider-adapter.observability.log_fields');
  requireArrayOfStrings(providerDoc?.validation_rules, 'provider-adapter.validation_rules');
}

const VALID_MODES = new Set(['Research', 'Build', 'Debug', 'Operate', 'Policy']);
const VALID_ZONE_RULES = new Set(['single-zone-preferred', 'global-scan-allowed']);
const VALID_PACKET_TYPES = new Set([
  'arch',
  'governance',
  'meta',
  'shell',
  'executor',
  'feature',
  'bugfix',
  'refactor',
  'docs',
  'ops',
  'spike',
]);

function validateGoldenSet(intakeSchema) {
  const content = fs.readFileSync(GOLDEN_SET_PATH, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (content.length < 5) {
    fail('harness contract validation FAIL: golden set must contain at least 5 cases');
  }

  const requiredInputFields = (Array.isArray(intakeSchema.required) ? intakeSchema.required : [])
    .filter((field) => !['packet_type', 'risk_level', 'trust_level', 'evidence_required', 'interactive_class'].includes(field));

  content.forEach((line, index) => {
    let record;
    try {
      record = JSON.parse(line);
    } catch (_) {
      fail(`harness contract validation FAIL: golden set line ${index + 1} is not valid JSON`);
    }

    const lineLabel = `golden set line ${index + 1}`;

    if (!record.input || typeof record.input !== 'object') {
      fail(`harness contract validation FAIL: ${lineLabel} missing input object`);
    }

    requiredInputFields.forEach((field) => {
      if (!(field in record.input)) {
        fail(`harness contract validation FAIL: ${lineLabel} missing input.${field}`);
      }
    });

    if (!VALID_MODES.has(record.mode)) {
      fail(`harness contract validation FAIL: ${lineLabel} invalid or missing mode: ${record.mode}`);
    }

    if (!VALID_PACKET_TYPES.has(record.packet_type)) {
      fail(`harness contract validation FAIL: ${lineLabel} invalid or missing packet_type: ${record.packet_type}`);
    }

    if (record.expect?.zone_rule !== undefined && !VALID_ZONE_RULES.has(record.expect.zone_rule)) {
      fail(`harness contract validation FAIL: ${lineLabel} invalid zone_rule: ${record.expect.zone_rule}`);
    }

    if (typeof record.expect?.false_pass_forbidden !== 'boolean') {
      fail(`harness contract validation FAIL: ${lineLabel} missing or non-boolean expect.false_pass_forbidden`);
    }
  });
}

function validateExecutionPacketSchema(schema) {
  requireRequiredFields(schema, [
    'schema_version',
    'packet_id',
    'goal',
    'mode',
    'packet_type',
    'intake_packet',
    'scope',
    'context_lock',
    'validation_profile',
    'rollback_plan',
    'evidence_policy',
  ], 'execution-packet.schema');
  requireEnum(schema, 'mode', ['Research', 'Build', 'Debug', 'Operate', 'Policy'], 'execution-packet.schema');

  const scopeRequired = schema?.properties?.scope?.required || [];
  ['scope_in', 'scope_out'].forEach((field) => {
    if (!scopeRequired.includes(field)) {
      fail(`harness contract validation FAIL: execution-packet.schema.scope missing required field ${field}`);
    }
  });

  const contextLockRequired = schema?.properties?.context_lock?.required || [];
  ['path', 'drift_status'].forEach((field) => {
    if (!contextLockRequired.includes(field)) {
      fail(`harness contract validation FAIL: execution-packet.schema.context_lock missing required field ${field}`);
    }
  });

  const evidencePolicyRequired = schema?.properties?.evidence_policy?.required || [];
  ['pass_requires_observed_evidence', 'missing_evidence_status'].forEach((field) => {
    if (!evidencePolicyRequired.includes(field)) {
      fail(`harness contract validation FAIL: execution-packet.schema.evidence_policy missing required field ${field}`);
    }
  });
}

function validateExecutionPacketGoldenSet(executionPacketSchema) {
  const content = fs.readFileSync(GOLDEN_SET_PATH, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const required = Array.isArray(executionPacketSchema.required) ? executionPacketSchema.required : [];
  let executionPacketCount = 0;

  content.forEach((line, index) => {
    const record = JSON.parse(line);
    if (!record.execution_packet) {
      return;
    }

    executionPacketCount += 1;
    const lineLabel = `golden set line ${index + 1} execution_packet`;
    required.forEach((field) => {
      if (!(field in record.execution_packet)) {
        fail(`harness contract validation FAIL: ${lineLabel} missing ${field}`);
      }
    });

    ['goal', 'context', 'constraints', 'done_when', 'work_mode', 'verification'].forEach((field) => {
      if (!(field in record.execution_packet.intake_packet)) {
        fail(`harness contract validation FAIL: ${lineLabel}.intake_packet missing ${field}`);
      }
    });

    if (!Array.isArray(record.execution_packet.scope?.scope_in)) {
      fail(`harness contract validation FAIL: ${lineLabel}.scope.scope_in must be array`);
    }
    if (!Array.isArray(record.execution_packet.scope?.scope_out)) {
      fail(`harness contract validation FAIL: ${lineLabel}.scope.scope_out must be array`);
    }
    if (!Array.isArray(record.execution_packet.validation_profile?.required)) {
      fail(`harness contract validation FAIL: ${lineLabel}.validation_profile.required must be array`);
    }
    if (record.execution_packet.evidence_policy?.pass_requires_observed_evidence !== true) {
      fail(`harness contract validation FAIL: ${lineLabel}.evidence_policy.pass_requires_observed_evidence must be true`);
    }
  });

  if (executionPacketCount < 1) {
    fail('harness contract validation FAIL: golden set must contain at least one execution_packet case');
  }
}

function main() {
  [
    INTAKE_SCHEMA_PATH,
    EXECUTION_PACKET_SCHEMA_PATH,
    RAW_INTENT_SCHEMA_PATH,
    WP_DAG_SCHEMA_PATH,
    OUTPUT_SCHEMA_PATH,
    COMPLETION_REPORT_SCHEMA_PATH,
    PROVIDER_ADAPTER_PATH,
    GOLDEN_SET_PATH,
    HARNESS_CONTRACT_PATH,
  ].forEach(requireFile);

  const rawIntentSchema = readJson(RAW_INTENT_SCHEMA_PATH);
  const intakeSchema = readJson(INTAKE_SCHEMA_PATH);
  const executionPacketSchema = readJson(EXECUTION_PACKET_SCHEMA_PATH);
  const wpDagSchema = readJson(WP_DAG_SCHEMA_PATH);
  const outputSchema = readJson(OUTPUT_SCHEMA_PATH);
  const completionReportSchema = readJson(COMPLETION_REPORT_SCHEMA_PATH);
  const harnessContract = readYaml(HARNESS_CONTRACT_PATH);
  const providerAdapterContract = readYaml(PROVIDER_ADAPTER_PATH);

  requireRequiredFields(rawIntentSchema, ['raw_intent', 'goal', 'session_context'], 'raw-intent.schema');
  requireRequiredFields(intakeSchema, ['goal', 'context', 'constraints', 'done_when', 'work_mode', 'verification'], 'intake.schema');
  requireRequiredFields(intakeSchema, ['packet_type', 'risk_level', 'trust_level', 'evidence_required', 'interactive_class'], 'intake.schema');
  validateExecutionPacketSchema(executionPacketSchema);
  requireRequiredFields(wpDagSchema, ['schema_version', 'session_id', 'intake_packet', 'wp_list', 'edges'], 'wp-dag.schema');
  requireRequiredFields(outputSchema, [
    'session_id',
    'wp_id',
    'verification_status',
    'evidence_status',
    'tests_run',
    'tests_planned',
    'rollback_plan',
    'summary',
    'analysis',
    'change_points',
    'verification',
    'risks',
    'next_action',
    'changed_files',
    'evidence',
    'provider',
    'token_usage',
    'attempt',
  ], 'output.schema');
  requireRequiredFields(completionReportSchema, ['session_id', 'wp_id', 'verification_status', 'evidence_status', 'summary', 'changed_files', 'evidence', 'provider', 'token_usage', 'attempt'], 'completion-report.schema');

  requireEnum(outputSchema, 'verification_status', ['PASS', 'PARTIAL_PASS', 'FAIL', 'PLANNED', 'NOT_RUN'], 'output.schema');
  requireEnum(outputSchema, 'evidence_status', ['observed', 'mixed', 'planned', 'not_observed'], 'output.schema');
  requireEnum(intakeSchema, 'packet_type', ['feature', 'bugfix', 'refactor', 'docs', 'ops', 'spike'], 'intake.schema');
  requireEnum(intakeSchema, 'risk_level', ['low', 'medium', 'high', 'critical'], 'intake.schema');

  validateHarnessYaml(harnessContract);
  validateProviderAdapterYaml(providerAdapterContract);
  validateGoldenSet(intakeSchema);
  validateExecutionPacketGoldenSet(executionPacketSchema);

  process.stdout.write('harness contract validation PASS\n');
}

if (require.main === module) {
  main();
}
