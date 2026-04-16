#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT = path.join(REPO_ROOT, 'artifacts', 'deployment-smoke', 'latest.json');
const DEFAULT_SLO_POLICY = path.join(REPO_ROOT, 'master-shell', 'observability', 'slo-policy.json');
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
    '  --video-write-permissions <csv> Default: video:read,video:write',
    '  --video-read-permissions <csv>  Default: video:read',
    '  --flag-off-path <path>          Optional path expected to return 404 when a feature is disabled',
    '  --flag-off-permissions <csv>    Default: task:read',
    '  --require-flag-off              Fail if --flag-off-path is not provided',
    '  --require-https                 Fail if base URL is not HTTPS (ingress TLS gate)',
    '  --live-path <path>              Default: /livez',
    '  --startup-path <path>           Default: /startupz',
    '  --ready-path <path>             Default: /readyz',
    '  --health-path <path>            Default: /health',
    '  --tasks-path <path>             Default: /tasks',
    '  --billing-invoices-path <path>  Default: /billing/invoices',
    '  --videos-path <path>            Default: /videos',
    '  --user-id <id>                  Default: smoke-user',
    '  --timeout-ms <ms>               Default: 8000',
    '  --reviewers-approved <n>        Default: 1',
    '  --slo-policy <path>             Default: master-shell/observability/slo-policy.json',
    '  --output <path>                 Default: artifacts/deployment-smoke/latest.json',
    '  --help                          Show this help message',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    taskWritePermissions: 'task:read,task:write',
    taskReadPermissions: 'task:read',
    billingDeniedPermissions: '',
    videoWritePermissions: 'video:read,video:write',
    videoReadPermissions: 'video:read',
    flagOffPermissions: 'task:read',
    requireFlagOff: false,
    livePath: '/livez',
    startupPath: '/startupz',
    readyPath: '/readyz',
    healthPath: '/health',
    tasksPath: '/tasks',
    billingInvoicesPath: '/billing/invoices',
    videosPath: '/videos',
    userId: 'smoke-user',
    timeoutMs: 8000,
    reviewersApproved: 1,
    sloPolicyPath: DEFAULT_SLO_POLICY,
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
    if (current === '--require-https') {
      options.requireHttps = true;
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
      case '--video-write-permissions':
        options.videoWritePermissions = next;
        break;
      case '--video-read-permissions':
        options.videoReadPermissions = next;
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
      case '--live-path':
        options.livePath = next;
        break;
      case '--startup-path':
        options.startupPath = next;
        break;
      case '--ready-path':
        options.readyPath = next;
        break;
      case '--tasks-path':
        options.tasksPath = next;
        break;
      case '--billing-invoices-path':
        options.billingInvoicesPath = next;
        break;
      case '--videos-path':
        options.videosPath = next;
        break;
      case '--user-id':
        options.userId = next;
        break;
      case '--timeout-ms':
        options.timeoutMs = Number.parseInt(next, 10);
        break;
      case '--reviewers-approved':
        options.reviewersApproved = Number.parseInt(next, 10);
        break;
      case '--slo-policy':
        options.sloPolicyPath = path.resolve(process.cwd(), next);
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
  if (!Number.isInteger(options.reviewersApproved) || options.reviewersApproved < 0) {
    throw new Error('--reviewers-approved must be a non-negative integer');
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

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readSloPolicy(policyPath) {
  const policy = loadJson(policyPath);
  const protection = policy && typeof policy === 'object' ? policy.deployment_protection : null;
  const budgets = policy && typeof policy === 'object' ? policy.budgets : null;
  if (!protection || typeof protection !== 'object') {
    throw new Error(`Invalid SLO policy: deployment_protection missing in ${policyPath}`);
  }
  if (!budgets || typeof budgets !== 'object') {
    throw new Error(`Invalid SLO policy: budgets missing in ${policyPath}`);
  }
  return policy;
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
    accept: 'application/json, application/problem+json',
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
      headers: Object.fromEntries(response.headers.entries()),
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

function assertProblemResponse(result, { status, code, instance, message }) {
  assertResponse(result, { status, code, message });

  const contentType = String(result.headers?.['content-type'] || '');
  if (!/^application\/problem\+json\b/i.test(contentType)) {
    throw new SmokeAssertionError('Expected application/problem+json error response', {
      expectedContentType: 'application/problem+json',
      actualContentType: contentType,
      body: sanitizeBody(result.body),
    });
  }

  if (!result.body || typeof result.body !== 'object') {
    throw new SmokeAssertionError('Problem Details body must be a JSON object', {
      body: sanitizeBody(result.body),
    });
  }
  if (result.body.status !== status) {
    throw new SmokeAssertionError(`Problem Details status must be ${status}`, {
      expectedStatus: status,
      actualStatus: result.body.status,
      body: sanitizeBody(result.body),
    });
  }
  if (typeof result.body.type !== 'string' || typeof result.body.title !== 'string') {
    throw new SmokeAssertionError('Problem Details body must include string type and title fields', {
      body: sanitizeBody(result.body),
    });
  }
  if (instance !== undefined && result.body.instance !== instance) {
    throw new SmokeAssertionError(`Problem Details instance must equal ${instance}`, {
      expectedInstance: instance,
      actualInstance: result.body.instance,
      body: sanitizeBody(result.body),
    });
  }
}

async function runStep(report, definition, runner) {
  const startedAt = Date.now();
  try {
    const detail = await runner();
    const durationMs = Date.now() - startedAt;
    const budget = definition.budgetId ? report.slo_policy.budgets[definition.budgetId] : null;
    if (budget && typeof budget.latency_budget_ms === 'number' && durationMs > budget.latency_budget_ms) {
      throw new SmokeAssertionError(
        `Latency budget exceeded for ${definition.id}: ${durationMs}ms > ${budget.latency_budget_ms}ms`,
        {
          budget_id: definition.budgetId,
          actual_duration_ms: durationMs,
          latency_budget_ms: budget.latency_budget_ms,
        }
      );
    }
    report.steps.push({
      id: definition.id,
      name: definition.name,
      status: 'PASS',
      duration_ms: durationMs,
      slo: budget ? {
        budget_id: definition.budgetId,
        latency_budget_ms: budget.latency_budget_ms,
        availability_percent: budget.availability_percent ?? null,
        error_budget_percent: budget.error_budget_percent ?? null,
      } : null,
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
  const sloPolicy = readSloPolicy(options.sloPolicyPath);
  const protection = sloPolicy.deployment_protection;
  const report = {
    schema_version: '1',
    generated_at_utc: new Date().toISOString(),
    overall_status: 'FAIL',
    target: {
      base_url: options.baseUrl,
      live_path: options.livePath,
      startup_path: options.startupPath,
      ready_path: options.readyPath,
      health_path: options.healthPath,
      tasks_path: options.tasksPath,
      billing_invoices_path: options.billingInvoicesPath,
      videos_path: options.videosPath,
      flag_off_path: options.flagOffPath || null,
    },
    inputs: {
      task_write_permissions: parseCsv(options.taskWritePermissions),
      task_read_permissions: parseCsv(options.taskReadPermissions),
      billing_denied_permissions: parseCsv(options.billingDeniedPermissions),
      video_write_permissions: parseCsv(options.videoWritePermissions),
      video_read_permissions: parseCsv(options.videoReadPermissions),
      flag_off_permissions: parseCsv(options.flagOffPermissions),
      require_flag_off: options.requireFlagOff,
      require_https: options.requireHttps ?? false,
      timeout_ms: options.timeoutMs,
      user_id: options.userId,
      reviewers_approved: options.reviewersApproved,
    },
    slo_policy: {
      path: path.relative(REPO_ROOT, options.sloPolicyPath),
      deployment_protection: protection,
      budgets: sloPolicy.budgets,
    },
    steps: [],
    pending_manual_checks: [
      'Confirm deployed platform logs retain trace_id or equivalent correlation for the smoke requests.',
    ],
  };

  try {
    await runStep(report, {
      id: 'deployment-protection',
      name: 'Deployment protection inputs satisfy the policy gate',
    }, async () => {
      if (options.reviewersApproved < protection.required_reviewers_min) {
        throw new SmokeAssertionError('Deployment protection reviewer gate not satisfied', {
          required_reviewers_min: protection.required_reviewers_min,
          reviewers_approved: options.reviewersApproved,
        });
      }

      return {
        protection_gate: {
          required_reviewers_min: protection.required_reviewers_min,
          reviewers_approved: options.reviewersApproved,
          smoke_must_pass: protection.smoke_must_pass,
          error_budget_policy: protection.error_budget_policy,
        },
      };
    });

    // ingress-https validation (WP-RUN-006)
    if (options.requireHttps) {
      await runStep(report, {
        id: 'ingress-https',
        name: 'Ingress target uses HTTPS (TLS required)',
      }, async () => {
        const targetUrl = new URL(options.baseUrl);
        if (targetUrl.protocol !== 'https:') {
          throw new SmokeAssertionError('Ingress TLS validation failed: target is not HTTPS', {
            protocol: targetUrl.protocol,
            base_url: options.baseUrl,
            rollback_trigger: true,
          });
        }
        return { protocol: targetUrl.protocol, tls_required: true };
      });
    }

    await runStep(report, {
      id: 'livez',
      name: 'Liveness probe returns 200',
      budgetId: 'health',
    }, async () => {
      const result = await requestJson(options.baseUrl, {
        method: 'GET',
        routePath: options.livePath,
        permissions: [],
        userId: options.userId,
        timeoutMs: options.timeoutMs,
      });

      assertResponse(result, {
        status: 200,
        bodyCheck(body) {
          if (!body || body.status !== 'alive') {
            throw new SmokeAssertionError('Liveness probe must expose status=alive', {
              body: sanitizeBody(body),
            });
          }
        },
      });

      return {
        request: { method: 'GET', path: options.livePath },
        response: { status: result.status, headers: result.headers, body: sanitizeBody(result.body), duration_ms: result.durationMs },
      };
    });

    await runStep(report, {
      id: 'startupz',
      name: 'Startup probe returns 200',
      budgetId: 'health',
    }, async () => {
      const result = await requestJson(options.baseUrl, {
        method: 'GET',
        routePath: options.startupPath,
        permissions: [],
        userId: options.userId,
        timeoutMs: options.timeoutMs,
      });

      assertResponse(result, {
        status: 200,
        bodyCheck(body) {
          if (!body || body.status !== 'started') {
            throw new SmokeAssertionError('Startup probe must expose status=started', {
              body: sanitizeBody(body),
            });
          }
        },
      });

      return {
        request: { method: 'GET', path: options.startupPath },
        response: { status: result.status, headers: result.headers, body: sanitizeBody(result.body), duration_ms: result.durationMs },
      };
    });

    await runStep(report, {
      id: 'readyz',
      name: 'Readiness probe returns 200 and loaded runtime dependencies',
      budgetId: 'health',
    }, async () => {
      const result = await requestJson(options.baseUrl, {
        method: 'GET',
        routePath: options.readyPath,
        permissions: [],
        userId: options.userId,
        timeoutMs: options.timeoutMs,
      });

      assertResponse(result, {
        status: 200,
        bodyCheck(body) {
          if (!body || body.status !== 'ready' || body.feature_flags?.flagsLoaded !== true || body.feature_flags?.metadataLoaded !== true) {
            throw new SmokeAssertionError('Readiness probe must expose status=ready with loaded feature flag state', {
              body: sanitizeBody(body),
            });
          }
        },
      });

      return {
        request: { method: 'GET', path: options.readyPath },
        response: { status: result.status, headers: result.headers, body: sanitizeBody(result.body), duration_ms: result.durationMs },
      };
    });

    const health = await runStep(report, {
      id: 'health',
      name: 'Health endpoint returns 200 and exposes runtime trace ID',
      budgetId: 'health',
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
        response: { status: result.status, headers: result.headers, body: sanitizeBody(result.body), duration_ms: result.durationMs },
      };
    });

    const createdTask = await runStep(report, {
      id: 'task-create',
      name: 'Task create path works with write permissions',
      budgetId: 'task-management-plugin',
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
        response: { status: result.status, headers: result.headers, body: sanitizeBody(result.body), duration_ms: result.durationMs },
        task_id: result.body.task_id,
        health_trace_id: health.response.body.traceId,
      };
    });

    await runStep(report, {
      id: 'task-read',
      name: 'Task read path returns the created task',
      budgetId: 'task-management-plugin',
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
        response: { status: result.status, headers: result.headers, body: sanitizeBody(result.body), duration_ms: result.durationMs },
      };
    });

    await runStep(report, {
      id: 'billing-permission-denied',
      name: 'Billing write path rejects missing permissions',
      budgetId: 'billing-plugin',
    }, async () => {
      const result = await requestJson(options.baseUrl, {
        method: 'POST',
        routePath: options.billingInvoicesPath,
        permissions: parseCsv(options.billingDeniedPermissions),
        userId: options.userId,
        timeoutMs: options.timeoutMs,
        body: { customer_id: 'deployment-smoke-customer' },
      });

      assertProblemResponse(result, {
        status: 403,
        code: 'FORBIDDEN',
        instance: options.billingInvoicesPath,
      });

      return {
        request: { method: 'POST', path: options.billingInvoicesPath },
        response: { status: result.status, headers: result.headers, body: sanitizeBody(result.body), duration_ms: result.durationMs },
      };
    });

    const uploadedVideo = await runStep(report, {
      id: 'video-upload',
      name: 'Video upload path works with write permissions',
      budgetId: 'video-plugin',
    }, async () => {
      const result = await requestJson(options.baseUrl, {
        method: 'POST',
        routePath: options.videosPath,
        permissions: parseCsv(options.videoWritePermissions),
        userId: options.userId,
        timeoutMs: options.timeoutMs,
        body: {
          title: `deployment-smoke-video-${Date.now()}`,
          original_file_ref: 's3://deployment-smoke/video.mp4',
          file_size_bytes: 0,
        },
      });

      assertResponse(result, {
        status: 201,
        bodyCheck(body) {
          if (!body || typeof body.video_id !== 'string' || body.video_id.length === 0) {
            throw new SmokeAssertionError('Video upload response must include video_id', {
              body: sanitizeBody(body),
            });
          }
          if (body.file_size_bytes !== 0) {
            throw new SmokeAssertionError('Video upload response must preserve zero file_size_bytes', {
              body: sanitizeBody(body),
            });
          }
        },
      });

      return {
        request: { method: 'POST', path: options.videosPath },
        response: { status: result.status, headers: result.headers, body: sanitizeBody(result.body), duration_ms: result.durationMs },
        video_id: result.body.video_id,
      };
    });

    await runStep(report, {
      id: 'video-list',
      name: 'Video list path returns the uploaded video for the same caller',
      budgetId: 'video-plugin',
    }, async () => {
      const result = await requestJson(options.baseUrl, {
        method: 'GET',
        routePath: options.videosPath,
        permissions: parseCsv(options.videoReadPermissions),
        userId: options.userId,
        timeoutMs: options.timeoutMs,
      });

      assertResponse(result, {
        status: 200,
        bodyCheck(body) {
          const items = Array.isArray(body?.items) ? body.items : [];
          const matched = items.find((item) => item.video_id === uploadedVideo.video_id);
          if (!matched) {
            throw new SmokeAssertionError('Video list response must include the uploaded video', {
              expectedVideoId: uploadedVideo.video_id,
              body: sanitizeBody(body),
            });
          }
          if (matched.file_size_bytes !== 0) {
            throw new SmokeAssertionError('Video list response must preserve zero file_size_bytes', {
              expectedVideoId: uploadedVideo.video_id,
              body: sanitizeBody(body),
            });
          }
        },
      });

      return {
        request: { method: 'GET', path: options.videosPath },
        response: { status: result.status, headers: result.headers, body: sanitizeBody(result.body), duration_ms: result.durationMs },
      };
    });

    if (options.flagOffPath) {
      await runStep(report, {
        id: 'flag-off-route',
        name: 'Configured disabled route stays hidden with 404',
        budgetId: 'video-plugin',
      }, async () => {
        const result = await requestJson(options.baseUrl, {
          method: 'GET',
          routePath: options.flagOffPath,
          permissions: parseCsv(options.flagOffPermissions),
          userId: options.userId,
          timeoutMs: options.timeoutMs,
        });

        assertProblemResponse(result, {
          status: 404,
          code: 'NOT_FOUND',
          instance: options.flagOffPath,
        });

        return {
          request: { method: 'GET', path: options.flagOffPath },
          response: { status: result.status, headers: result.headers, body: sanitizeBody(result.body), duration_ms: result.durationMs },
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
    report.slo_gate = {
      status: 'PASS',
      policy: protection.error_budget_policy,
      budgets_checked: Object.keys(sloPolicy.budgets),
    };
    return report;
  } catch (error) {
    report.failure = {
      message: error.message,
      detail: error.detail || null,
    };
    report.slo_gate = {
      status: 'FAIL',
      policy: protection.error_budget_policy,
      budgets_checked: Object.keys(sloPolicy.budgets),
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
