'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../..');

function normalizeErrors(value) {
  return Array.isArray(value) ? value.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
}

function relativeRepoPath(targetPath) {
  return path.relative(ROOT, targetPath).replace(/\\/g, '/');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readYaml(filePath) {
  const script = [
    'import json, pathlib, sys, yaml',
    'file_path = pathlib.Path(sys.argv[1])',
    'data = yaml.safe_load(file_path.read_text(encoding="utf-8")) or {}',
    'print(json.dumps(data, ensure_ascii=False))',
  ].join('; ');
  const result = spawnSync('python3', ['-c', script, filePath], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`unable to read yaml ${relativeRepoPath(filePath)}: ${String(result.stderr || '').trim()}`);
  }
  return JSON.parse(result.stdout || '{}');
}

function writeYaml(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${toYaml(value)}\n`, 'utf8');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatScalar(value) {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  return JSON.stringify(String(value));
}

function toYaml(value, indent = 0) {
  const prefix = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    return value.map((entry) => {
      if (isPlainObject(entry) || Array.isArray(entry)) {
        const nested = toYaml(entry, indent + 2);
        const nestedLines = String(nested).split('\n');
        const firstLine = nestedLines[0].trimStart();
        const remaining = nestedLines.slice(1).join('\n');
        return remaining
          ? `${prefix}- ${firstLine}\n${remaining}`
          : `${prefix}- ${firstLine}`;
      }
      return `${prefix}- ${formatScalar(entry)}`;
    }).join('\n');
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return '{}';
    }
    return entries.map(([key, entry]) => {
      if (Array.isArray(entry) && entry.length === 0) {
        return `${prefix}${key}: []`;
      }
      if (isPlainObject(entry) && Object.keys(entry).length === 0) {
        return `${prefix}${key}: {}`;
      }
      if (isPlainObject(entry) || Array.isArray(entry)) {
        const nested = toYaml(entry, indent + 2);
        return `${prefix}${key}:\n${nested}`;
      }
      return `${prefix}${key}: ${formatScalar(entry)}`;
    }).join('\n');
  }
  return `${prefix}${formatScalar(value)}`;
}

function resolveSchemaRef(schema, defs = {}) {
  if (!schema || typeof schema !== 'object' || !schema.$ref) {
    return schema;
  }
  const ref = String(schema.$ref);
  if (!ref.startsWith('#/$defs/')) {
    return schema;
  }
  const key = ref.slice('#/$defs/'.length);
  return defs[key] || schema;
}

function validateAgainstSchema(schema, value, currentPath = '$', defs = {}) {
  const resolved = resolveSchemaRef(schema, defs);
  const errors = [];
  if (!resolved || typeof resolved !== 'object') {
    return errors;
  }

  if (Array.isArray(resolved.enum) && !resolved.enum.includes(value)) {
    errors.push(`${currentPath}: must be one of ${resolved.enum.join(', ')}`);
    return errors;
  }
  if (Object.prototype.hasOwnProperty.call(resolved, 'const') && value !== resolved.const) {
    errors.push(`${currentPath}: must equal ${JSON.stringify(resolved.const)}`);
    return errors;
  }

  if (resolved.type === 'string') {
    if (typeof value !== 'string') {
      errors.push(`${currentPath}: must be a string`);
      return errors;
    }
    if (Number.isInteger(resolved.minLength) && value.length < resolved.minLength) {
      errors.push(`${currentPath}: must have length >= ${resolved.minLength}`);
    }
    return errors;
  }

  if (resolved.type === 'integer') {
    if (!Number.isInteger(value)) {
      errors.push(`${currentPath}: must be an integer`);
      return errors;
    }
    if (Number.isFinite(resolved.minimum) && value < resolved.minimum) {
      errors.push(`${currentPath}: must be >= ${resolved.minimum}`);
    }
    return errors;
  }

  if (resolved.type === 'boolean') {
    if (typeof value !== 'boolean') {
      errors.push(`${currentPath}: must be a boolean`);
    }
    return errors;
  }

  if (resolved.type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${currentPath}: must be an array`);
      return errors;
    }
    if (Number.isInteger(resolved.minItems) && value.length < resolved.minItems) {
      errors.push(`${currentPath}: must contain at least ${resolved.minItems} items`);
    }
    if (resolved.items) {
      value.forEach((entry, index) => {
        errors.push(...validateAgainstSchema(resolved.items, entry, `${currentPath}.${index}`, defs));
      });
    }
    return errors;
  }

  if (resolved.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${currentPath}: must be an object`);
      return errors;
    }
    const properties = resolved.properties || {};
    const required = Array.isArray(resolved.required) ? resolved.required : [];
    required.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(`${currentPath}.${key}: is required`);
      }
    });
    if (resolved.additionalProperties === false) {
      Object.keys(value).forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          errors.push(`${currentPath}.${key}: additional property not allowed`);
        }
      });
    }
    Object.entries(properties).forEach(([key, childSchema]) => {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(...validateAgainstSchema(childSchema, value[key], `${currentPath}.${key}`, defs));
      }
    });
    return errors;
  }

  return errors;
}

class ContractValidationError extends Error {
  constructor(message, { schemaPath = '', errors = [] } = {}) {
    super(message);
    this.name = 'ContractValidationError';
    this.code = 'CONTRACT_VALIDATION_FAILED';
    this.schemaPath = schemaPath;
    this.errors = normalizeErrors(errors);
  }
}

class ContractValidator {
  constructor({ root = ROOT } = {}) {
    this.root = root;
  }

  resolve(relativePath) {
    return path.resolve(this.root, relativePath);
  }

  exists(relativePath) {
    return fs.existsSync(this.resolve(relativePath));
  }

  readContract(relativePath) {
    const target = this.resolve(relativePath);
    if (!fs.existsSync(target)) {
      throw new Error(`contract not found: ${relativePath}`);
    }
    if (target.endsWith('.json')) {
      return readJson(target);
    }
    if (target.endsWith('.yaml') || target.endsWith('.yml')) {
      return readYaml(target);
    }
    return fs.readFileSync(target, 'utf8');
  }

  writeYaml(relativePath, value) {
    writeYaml(this.resolve(relativePath), value);
  }

  validate(relativeSchemaPath, payload, { invariant = 'CONTRACT-INV-01', label = '' } = {}) {
    const schemaPath = this.resolve(relativeSchemaPath);
    if (!fs.existsSync(schemaPath)) {
      throw new ContractValidationError(`missing schema: ${relativeSchemaPath}`, {
        schemaPath: relativeSchemaPath,
        errors: [`${relativeSchemaPath}: schema file missing`],
      });
    }

    const schema = readJson(schemaPath);
    const errors = validateAgainstSchema(schema, payload, '$', schema.$defs || {});
    if (errors.length > 0) {
      throw new ContractValidationError(
        `${invariant}: ${label || 'payload'} does not satisfy ${relativeSchemaPath}`,
        {
          schemaPath: relativeSchemaPath,
          errors: normalizeErrors(errors),
        },
      );
    }
    return payload;
  }

  validateInput(relativeSchemaPath, payload, label = 'input') {
    return this.validate(relativeSchemaPath, payload, {
      invariant: 'CONTRACT-INV-01',
      label,
    });
  }

  validateOutput(relativeSchemaPath, payload, label = 'output') {
    return this.validate(relativeSchemaPath, payload, {
      invariant: 'CONTRACT-INV-02',
      label,
    });
  }
}

module.exports = {
  ContractValidator,
  ContractValidationError,
  relativeRepoPath,
  readJson,
  readYaml,
  toYaml,
};
