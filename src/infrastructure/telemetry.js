//@ts-check
'use strict';

/**
 * Telemetry — OpenTelemetry API 호환 경량 계측 레이어
 *
 * Benchmark:
 *   - OpenTelemetry Spec (CNCF) — trace/metric/log 3-signal 표준
 *   - Google SRE RED Method — Rate, Errors, Duration 핵심 지표
 *   - 12-Factor App #11 — Logs as event streams (stdout JSON)
 *   - W3C Trace Context — traceparent 헤더 파싱
 *
 * 설계:
 *   - 외부 런타임 의존성 없음 (프로젝트 정책 준수)
 *   - OpenTelemetry SDK로 투명 교체 가능 (동일 API surface)
 *   - OTLP 익스포터로 Jaeger / Prometheus / DataDog 연결 가능
 *
 * 사용:
 *   const { tracer, meter, logger } = require('./telemetry');
 *   const span = tracer.startSpan('task.create');
 *   // ... work ...
 *   span.setStatus('ok').end();
 */

const { randomUUID } = require('node:crypto');

// ── Tracer ────────────────────────────────────────────────────────────────────

class Span {
  /**
   * @param {string} name
   * @param {{ traceId?: string, parentSpanId?: string, attributes?: Record<string,unknown> }} [opts]
   */
  constructor(name, { traceId, parentSpanId, attributes = {} } = {}) {
    this.name         = name;
    this.traceId      = traceId || randomUUID().replace(/-/g, '');
    this.spanId       = randomUUID().replace(/-/g, '').slice(0, 16);
    this.parentSpanId = parentSpanId || null;
    this.startTime    = Date.now();
    this.endTime      = null;
    this.status       = 'unset';     // 'ok' | 'error' | 'unset'
    this.attributes   = { ...attributes };
    this._error       = null;
  }

  /** @param {string} key @param {unknown} value */
  setAttribute(key, value) { this.attributes[key] = value; return this; }

  /** @param {'ok'|'error'} status @param {string} [message] */
  setStatus(status, message) {
    this.status = status;
    if (message) this.attributes['status.message'] = message;
    return this;
  }

  /** @param {Error} err */
  recordException(err) {
    this._error = err;
    this.attributes['exception.type']    = err.constructor.name;
    this.attributes['exception.message'] = err.message;
    this.status = 'error';
    return this;
  }

  end() {
    this.endTime = Date.now();
    const duration = this.endTime - this.startTime;
    // 구조화 로그 emit (12-factor #11)
    logger.info('span.end', {
      trace_id:       this.traceId,
      span_id:        this.spanId,
      parent_span_id: this.parentSpanId,
      name:           this.name,
      duration_ms:    duration,
      status:         this.status,
      attributes:     this.attributes,
    });
    return this;
  }

  /** W3C Trace Context traceparent 헤더 값 */
  get traceparent() {
    return `00-${this.traceId}-${this.spanId}-01`;
  }
}

class Tracer {
  /**
   * @param {string} name  span 이름
   * @param {{ traceId?: string, parentSpanId?: string, attributes?: Record<string,unknown> }} [opts]
   * @returns {Span}
   */
  startSpan(name, opts = {}) {
    return new Span(name, opts);
  }

  /**
   * W3C traceparent 헤더에서 trace context를 추출한다.
   * @param {string | undefined} traceparent
   * @returns {{ traceId: string, parentSpanId: string } | null}
   */
  extractContext(traceparent) {
    if (!traceparent || typeof traceparent !== 'string') return null;
    const parts = traceparent.split('-');
    if (parts.length < 4) return null;
    return { traceId: parts[1], parentSpanId: parts[2] };
  }
}

// ── Meter (RED Method) ────────────────────────────────────────────────────────

class Counter {
  /** @param {string} name @param {{ description?: string }} [opts] */
  constructor(name, { description = '' } = {}) {
    this.name        = name;
    this.description = description;
    this._value      = 0;
  }

  /** @param {number} [delta=1] @param {Record<string,unknown>} [attributes] */
  add(delta = 1, attributes = {}) {
    this._value += delta;
    logger.info('metric.counter', { name: this.name, delta, total: this._value, attributes });
  }

  get value() { return this._value; }
}

class Histogram {
  /** @param {string} name @param {{ description?: string, unit?: string }} [opts] */
  constructor(name, { description = '', unit = 'ms' } = {}) {
    this.name        = name;
    this.description = description;
    this.unit        = unit;
    this._recordings = [];
  }

  /** @param {number} value @param {Record<string,unknown>} [attributes] */
  record(value, attributes = {}) {
    this._recordings.push(value);
    logger.info('metric.histogram', { name: this.name, value, unit: this.unit, attributes });
  }
}

class Meter {
  constructor() {
    /** @type {Map<string, Counter>} */
    this._counters   = new Map();
    /** @type {Map<string, Histogram>} */
    this._histograms = new Map();
  }

  /**
   * @param {string} name
   * @param {{ description?: string }} [opts]
   * @returns {Counter}
   */
  createCounter(name, opts = {}) {
    if (!this._counters.has(name)) this._counters.set(name, new Counter(name, opts));
    return /** @type {Counter} */ (this._counters.get(name));
  }

  /**
   * @param {string} name
   * @param {{ description?: string, unit?: string }} [opts]
   * @returns {Histogram}
   */
  createHistogram(name, opts = {}) {
    if (!this._histograms.has(name)) this._histograms.set(name, new Histogram(name, opts));
    return /** @type {Histogram} */ (this._histograms.get(name));
  }
}

// ── Structured Logger (12-factor App #11) ─────────────────────────────────────

class StructuredLogger {
  /**
   * @param {'info'|'warn'|'error'|'debug'} level
   * @param {string} event
   * @param {Record<string,unknown>} [fields]
   */
  _emit(level, event, fields = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service:   'my-module',
      event,
      ...fields,
    };
    process.stdout.write(JSON.stringify(entry) + '\n');
  }

  /** @param {string} event @param {Record<string,unknown>} [fields] */
  info(event, fields)  { this._emit('info',  event, fields); }
  /** @param {string} event @param {Record<string,unknown>} [fields] */
  warn(event, fields)  { this._emit('warn',  event, fields); }
  /** @param {string} event @param {Record<string,unknown>} [fields] */
  error(event, fields) { this._emit('error', event, fields); }
  /** @param {string} event @param {Record<string,unknown>} [fields] */
  debug(event, fields) { this._emit('debug', event, fields); }
}

// ── 글로벌 싱글턴 ──────────────────────────────────────────────────────────────

const tracer = new Tracer();
const meter  = new Meter();
const logger = new StructuredLogger();

// ── RED Method 공용 메트릭 ─────────────────────────────────────────────────────
// Rate, Errors, Duration — Tom Wilkie (Grafana)

const metrics = {
  httpRequestsTotal:  meter.createCounter('http_requests_total',   { description: 'Total HTTP requests (Rate)' }),
  httpErrorsTotal:    meter.createCounter('http_errors_total',     { description: 'Total HTTP errors (Errors)' }),
  httpDurationMs:     meter.createHistogram('http_duration_ms',    { description: 'HTTP request duration (Duration)', unit: 'ms' }),
  taskCreatedTotal:   meter.createCounter('task_created_total',    { description: 'Tasks created' }),
  taskTransitionTotal:meter.createCounter('task_transition_total', { description: 'Task status transitions' }),
  invoiceCreatedTotal:meter.createCounter('invoice_created_total', { description: 'Invoices created' }),
  controlCenterPromptRecommendationsTotal: meter.createCounter('control_center_prompt_recommendations_total', {
    description: 'Recommended prompt generations for the control center',
  }),
  ptyBridgeSessionsReadTotal: meter.createCounter('pty_bridge_sessions_read_total', {
    description: 'PTY bridge session list reads',
  }),
  ptyBridgeSendTotal: meter.createCounter('pty_bridge_send_total', {
    description: 'PTY bridge prompt or enter sends',
  }),
  ptyBridgeFailuresTotal: meter.createCounter('pty_bridge_failures_total', {
    description: 'PTY bridge validation or execution failures',
  }),
  ptySchedulerStatusReadTotal: meter.createCounter('pty_scheduler_status_read_total', {
    description: 'PTY scheduler status reads',
  }),
  ptySchedulerStartTotal: meter.createCounter('pty_scheduler_start_total', {
    description: 'PTY scheduler start operations',
  }),
  ptySchedulerStopTotal: meter.createCounter('pty_scheduler_stop_total', {
    description: 'PTY scheduler stop operations',
  }),
  stageRunReportSavedTotal: meter.createCounter('stage_run_report_saved_total', {
    description: 'Stage run reports successfully persisted to planning studio memory',
  }),
  stageRunReportSaveFailuresTotal: meter.createCounter('stage_run_report_save_failures_total', {
    description: 'Stage run report persistence failures',
  }),
  controlCenterOperationDurationMs: meter.createHistogram('control_center_operation_duration_ms', {
    description: 'Control center bridge operation duration',
    unit: 'ms',
  }),
  // WP-HARNESS-VNEXT-006: GenAI / LLM 클라이언트 메트릭 (OTel GenAI 시맨틱 컨벤션)
  genAiClientOperationDurationMs: meter.createHistogram('gen_ai_client_operation_duration_ms', {
    description: 'GenAI client operation duration (latency)',
    unit: 'ms',
  }),
  genAiClientInputTokens: meter.createCounter('gen_ai_client_input_tokens', {
    description: 'GenAI client input tokens consumed',
  }),
  genAiClientOutputTokens: meter.createCounter('gen_ai_client_output_tokens', {
    description: 'GenAI client output tokens generated',
  }),
  genAiClientCacheReadInputTokens: meter.createCounter('gen_ai_client_cache_read_input_tokens', {
    description: 'GenAI client prompt-cache-read tokens',
  }),
};

// ── Harness telemetry context ─────────────────────────────────────────────────
// WP-HARNESS-VNEXT-006: prompt_version, mode, evidence_status 등 하네스 메타를
// 모든 OTel span에 자동 첨부하기 위한 모듈 레벨 컨텍스트 저장소.

const _harnessTelemetryDefaults = {
  prompt_version:  'unknown',
  mode:            'unknown',
  risk_level:      'unknown',
  evidence_status: 'unknown',
  model:           'unknown',
  reasoning_effort:'unknown',
  eval_run_id:     'unknown',
};

// eslint-disable-next-line prefer-const -- reassigned by setHarnessTelemetryContext
let _harnessTelemetryContext = { ..._harnessTelemetryDefaults };

/**
 * Return a snapshot of the current harness telemetry context.
 * @returns {{ prompt_version: string, mode: string, risk_level: string, evidence_status: string, model: string, reasoning_effort: string, eval_run_id: string }}
 */
function getHarnessTelemetryContext() {
  return { ..._harnessTelemetryContext };
}

/**
 * Merge partial harness metadata into the module-level context.
 * Unknown keys in the partial object are ignored.
 * @param {Partial<typeof _harnessTelemetryDefaults>} partial
 */
function setHarnessTelemetryContext(partial) {
  if (!partial || typeof partial !== 'object') return;
  const allowed = new Set(Object.keys(_harnessTelemetryDefaults));
  for (const [k, v] of Object.entries(partial)) {
    if (allowed.has(k)) _harnessTelemetryContext[k] = String(v ?? 'unknown');
  }
}

module.exports = { tracer, meter, logger, metrics, Span, Counter, Histogram, getHarnessTelemetryContext, setHarnessTelemetryContext };
