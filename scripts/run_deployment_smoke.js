#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT = path.join(REPO_ROOT, 'artifacts', 'deployment-smoke', 'latest.json');
const { fetch, AbortController } = globalThis;

function usage() {
  return [
    'Usage:',
    '  node scripts/run_deployment_smoke.js --base-url <url> [options]',
    '',
    'Required:',
    '  --base-url <url>                 Target deployment base URL, e.g. https://api.example.com',
    '',
    'Options:',
    '  --task-write-permissions <csv>  Default: task:read,task:write',
    '  --task-read-permissions <csv>   Default: task:read',
    '  --billing-denied-permissions    Default: empty',
    '  --flag-off-path <path>          Optional path expected to return 404 when a feature is disabled',
    '  --flag-off-permissions <csv>    Default: task:read',
    '  --require-flag-off              Fail if --flag-off-path is not provided',
    '  --health-path <path>            Default: /health',
    '  --tasks-path <path>             Default: /tasks',
    '  --billing-invoices-path <path>  Default: /billing/invoices',
    '  --user-id <id>                  Default: smoke-user',
    '  --timeout-ms <ms>               Default: 8000',
    '  --output <path>                 Default: artifacts/deployment-smoke/latest.json',
    '  --help                          Show this help message',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    taskWritePermissions: 'task:read,task:write',
    taskReadPermissions: 'task:read',
    billingDeniedPermissions: '',
    flagOffPermissions: 'task:read',
    requireFlagOff: false,
    healthPath: '/health',
    tasksPath: '/tasks',
    billingInvoicesPath: '/billing/invoices',
    userId: 'smoke-user',
    timeoutMs: 8000,
    output: DEFAULT_OUTPUT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--help') {
      options.help = true;
      continue;
    }
    if (current === '--require-flag-off') {
      options.requireFlagOff = true;
      continue;
    }
    if (!current.startsWith('--')) {
      throw new Error(`Unexpected argument: ${current}`);
    }

    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      throw new Error(`Missing value for ${current}`);
    }

    switch (current) {
      case '--base-url':
        options.baseUrl = next;
        break;
      case '--task-write-permissions':
        options.taskWritePermissions = next;
        break;
      case '--task-read-permissions':
        options.taskReadPermissions = next;
        break;
      case '--billing-denied-permissions':
        options.billingDeniedPermissions = next;
        break;
      case '--flag-off-path':
        options.flagOffPath = next;
        break;
      case '--flag-off-permissions':
        options.flagOffPermissions = next;
        break;
      case '--health-path':
        options.healthPath = next;
        break;
      case '--tasks-path':
        options.tasksPath = next;
        break;
      case '--billing-invoices-path':
        options.billingInvoicesPath = next;
        break;
      case '--user-id':
        options.userId = next;
        break;
      case '--timeout-ms':
        options.timeoutMs = Number.parseInt(next, 10);
        break;
      case '--output':
        options.output = path.resolve(process.cwd(), next);
        break;
      default:
        throw new Error(`Unknown option: ${current}`);
    }

    index += 1;
  }

  if (!options.help && !options.baseUrl) {
    throw new Error('--base-url is required');
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive integer');
  }
  if (options.requireFlagOff && !options.flagOffPath) {
    throw new Error('--require-flag-off requires --flag-off-path');
  }

  return options;
}

function parseCsv(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function futureDate(days = 30) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

class SmokeAssertionError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'SmokeAssertionError';
    this.detail = detail;
  }
}

function sanitizeBody(body) {
  if (body === null || body === undefined) {
    return body;
  }
  if (typeof body !== 'object') {
    return body;
  }
  return JSON.parse(JSON.stringify(body));
}

async function requestJson(baseUrl, {
  method,
  routePath,
  permissions,
  userId,
  timeoutMs,
  body,
}) {
  const url = new URL(routePath, baseUrl).toString();
  const headers = {
    accept: 'application/json',
    'x-user-id': userId,
    'x-correlation-id': 'deployment-smoke',
  };

  if (Array.isArray(permissions) && permissions.length > 0) {
    headers['x-permissions'] = permissions.join(',');
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const raw = await response.text();
    let parsedBody = raw;
    if (raw) {
      try {
        parsedBody = JSON.parse(raw);
      } catch {
        parsedBody = raw;
      }
    }

    return {
      url,
      status: response.status,
      body: parsedBody,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new SmokeAssertionError(`Request timed out after ${timeoutMs}ms`, { url, timeoutMs });
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function assertResponse(result, { status, code, bodyCheck, message }) {
  if (result.status !== status) {
    throw new SmokeAssertionError(message || `Expected HTTP ${status} but received ${result.status}`, {
      expectedStatus: status,
      actualStatus: result.status,
      body: sanitizeBody(result.body),
    });
  }

  if (code) {
    const actualCode = result.body && typeof result.body === 'object' ? result.body.code : undefined;
    if (actualCode !== code) {
      throw new SmokeAssertionError(`Expected response code ${code} but received ${String(actualCode)}`, {
        expectedCode: code,
        actualCode,
        body: sanitizeBody(result.body),
      });
    }
  }

  if (typeof bodyCheck === 'function') {
    bodyCheck(result.body);
  }
}

async function runStep(report, definition, runner) {
  const startedAt = Date.now();
  try {
    const detail = await runner();
    report.steps.push({
      id: definition.id,
      name: definition.name,
      status: 'PASS',
      duration_ms: Date.now() - startedAt,
      ...detail,
    });
    return detail;
  } catch (error) {
    report.steps.push({
      id: definition.id,
      name: definition.name,
      status: 'FAIL',
      duration_ms: Date.now() - startedAt,
      error: error.message,
      detail: error.detail || null,
    });
    throw error;
  }
}

function writeReport(report, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
}

function printSummary(report) {
  process.stdout.write(`Deployment smoke ${report.overall_status}\n`);
  for (const step of report.steps) {
    const suffix = step.status === 'FAIL' ? `: ${step.error}` : '';
    process.stdout.write(`- ${step.status.padEnd(7)} ${step.id}${suffix}\n`);
  }
  process.stdout.write(`Artifact: ${report.output_path}\n`);
}

async function run(options) {
  const report = {
    schema_version: '1',
    generated_at_utc: new Date().toISOString(),
    overall_status: 'FAIL',
    target: {
      base_url: options.baseUrl,
      health_path: options.healthPath,
      tasks_path: options.tasksPath,
      billing_invoices_path: options.billingInvoicesPath,
      flag_off_path: options.flagOffPath || null,
    },
    inputs: {
      task_write_permissions: parseCsv(options.taskWritePermissions),
      task_read_permissions: parseCsv(options.taskReadPermissions),
      billing_denied_permissions: parseCsv(options.billingDeniedPermissions),
      flag_off_permissions: parseCsv(options.flagOffPermissions),
      require_flag_off: options.requireFlagOff,
      timeout_ms: options.timeoutMs,
      user_id: options.userId,
    },
    steps: [],
    pending_manual_checks: [
      'Confirm deployed platform logs retain trace_id or equivalent correlation for the smoke requests.',
    ],
  };

  try {
    const health = await runStep(report, {
      id: 'health',
      name: 'Health endpoint returns 200 and exposes runtime trace ID',
    }, async () => {
      const result = await requestJson(options.baseUrl, {
        method: 'GET',
        routePath: options.healthPath,
        permissions: [],
        userId: options.userId,
        timeoutMs: options.timeoutMs,
      });

      assertResponse(result, {
        status: 200,
        bodyCheck(body) {
          if (!body || body.status !== 'ok' || typeof body.traceId !== 'string' || body.traceId.length === 0) {
            throw new SmokeAssertionError('Health response must expose status=ok and a non-empty traceId', {
              body: sanitizeBody(body),
            });
          }
        },
      });

      return {
        request: { method: 'GET', path: options.healthPath },
        response: { status: result.status, body: sanitizeBody(result.body) },
      };
    });

    const createdTask = await runStep(report, {
      id: 'task-create',
      name: 'Task create path works with write permissions',
    }, async () => {
      const result = await requestJson(options.baseUrl, {
        method: 'POST',
        routePath: options.tasksPath,
        permissions: parseCsv(options.taskWritePermissions),
        userId: options.userId,
        timeoutMs: options.timeoutMs,
        body: {
          title: `deployment-smoke-${Date.now()}`,
          assignee_id: 'deployment-smoke-user',
          due_date: futureDate(),
        },
      });

      assertResponse(result, {
        status: 201,
        bodyCheck(body) {
          if (!body || typeof body.task_id !== 'string' || body.task_id.length === 0) {
            throw new SmokeAssertionError('Task create response must include task_id', {
              body: sanitizeBody(body),
            });
          }
        },
      });

      return {
        request: { method: 'POST', path: options.tasksPath },
        response: { status: result.status, body: sanitizeBody(result.body) },
        task_id: result.body.task_id,
        health_trace_id: health.response.body.traceId,
      };
    });

    await runStep(report, {
      id: 'task-read',
      name: 'Task read path returns the created task',
    }, async () => {
      const result = await requestJson(options.baseUrl, {
        method: 'GET',
        routePath: `${options.tasksPath}/${createdTask.task_id}`,
        permissions: parseCsv(options.taskReadPermissions),
        userId: options.userId,
        timeoutMs: options.timeoutMs,
      });

      assertResponse(result, {
        status: 200,
        bodyCheck(body) {
          if (!body || body.task_id !== createdTask.task_id) {
            throw new SmokeAssertionError('Task read response must return the created task_id', {
              expectedTaskId: createdTask.task_id,
              body: sanitizeBody(body),
            });
          }
        },
      });

      return {
        request: { method: 'GET', path: `${options.tasksPath}/${createdTask.task_id}` },
        response: { status: result.status, body: sanitizeBody(result.body) },
      };
    });

    await runStep(report, {
      id: 'billing-permission-denied',
      name: 'Billing write path rejects missing permissions',
    }, async () => {
      const result = await requestJson(options.baseUrl, {
        method: 'POST',
        routePath: options.billingInvoicesPath,
        permissions: parseCsv(options.billingDeniedPermissions),
        userId: options.userId,
        timeoutMs: options.timeoutMs,
        body: { customer_id: 'deployment-smoke-customer' },
      });

      assertResponse(result, {
        status: 403,
        code: 'FORBIDDEN',
      });

      return {
        request: { method: 'POST', path: options.billingInvoicesPath },
        response: { status: result.status, body: sanitizeBody(result.body) },
      };
    });

    if (options.flagOffPath) {
      await runStep(report, {
        id: 'flag-off-route',
        name: 'Configured disabled route stays hidden with 404',
      }, async () => {
        const result = await requestJson(options.baseUrl, {
          method: 'GET',
          routePath: options.flagOffPath,
          permissions: parseCsv(options.flagOffPermissions),
          userId: options.userId,
          timeoutMs: options.timeoutMs,
        });

        assertResponse(result, {
          status: 404,
          code: 'NOT_FOUND',
        });

        return {
          request: { method: 'GET', path: options.flagOffPath },
          response: { status: result.status, body: sanitizeBody(result.body) },
        };
      });
    } else {
      report.steps.push({
        id: 'flag-off-route',
        name: 'Configured disabled route stays hidden with 404',
        status: 'SKIPPED',
        reason: 'No --flag-off-path supplied for this environment.',
      });
      report.pending_manual_checks.push(
        'If the target environment includes a disabled feature route, rerun with --flag-off-path to capture the 404 assertion.'
      );
    }

    report.overall_status = 'PASS';
    return report;
  } catch (error) {
    report.failure = {
      message: error.message,
      detail: error.detail || null,
    };
    return report;
  } finally {
    report.output_path = path.relative(REPO_ROOT, options.output);
    writeReport(report, options.output);
    printSummary(report);
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const report = await run(options);
  if (report.overall_status !== 'PASS') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
