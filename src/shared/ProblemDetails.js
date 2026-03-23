//@ts-check
'use strict';

/**
 * RFC 7807 Problem Details — 표준 에러 응답 생성기
 *
 * Benchmark: IETF RFC 7807 "Problem Details for HTTP APIs"
 * 채택 사례: Azure REST API, GitHub API, Stripe API, Spring Boot (RFC 9457)
 *
 * 응답 형식:
 * {
 *   "type":     "https://workflow-os/errors/not-found",
 *   "title":    "Not Found",
 *   "status":   404,
 *   "detail":   "Task with ID 'abc' does not exist.",
 *   "instance": "/tasks/abc",
 *   "traceId":  "4bf92f3577b34da6"   (extension field)
 * }
 */

const BASE_URI = 'https://workflow-os/errors';

/** 도메인 오류 코드 → HTTP 상태 + RFC 7807 type slug */
const ERROR_MAP = Object.freeze({
  FORBIDDEN:        { status: 403, slug: 'forbidden',         title: 'Forbidden' },
  NOT_FOUND:        { status: 404, slug: 'not-found',         title: 'Not Found' },
  CONFLICT:         { status: 409, slug: 'conflict',          title: 'Conflict' },
  VALIDATION_ERROR: { status: 400, slug: 'validation-error',  title: 'Validation Error' },
  IDEMPOTENCY_IN_PROGRESS: { status: 409, slug: 'idempotency-in-progress', title: 'Conflict' },
  IDEMPOTENCY_KEY_REUSE_MISMATCH: { status: 422, slug: 'idempotency-key-reuse-mismatch', title: 'Unprocessable Content' },
  INVALID_IDEMPOTENCY_KEY: { status: 400, slug: 'invalid-idempotency-key', title: 'Validation Error' },
  RATE_LIMITED: { status: 429, slug: 'rate-limited', title: 'Too Many Requests' },
  CONTENT_TOO_LARGE: { status: 413, slug: 'content-too-large', title: 'Content Too Large' },
  INTERNAL_ERROR:   { status: 500, slug: 'internal-error',    title: 'Internal Server Error' },
});

/**
 * @param {{
 *   type?:       string,
 *   title?:      string,
 *   status:      number,
 *   detail?:     string,
 *   instance?:   string | null,
 *   extensions?: Record<string, unknown>,
 * }} params
 * @returns {Record<string, unknown>}
 */
function createProblem({ type, title, status, detail, instance, extensions = {} }) {
  const body = {
    type:   type  || `${BASE_URI}/internal-error`,
    title:  title || 'Internal Server Error',
    status,
  };
  if (detail)   { body.detail = detail; body.message = detail; }  // message: 하위 호환 별칭
  if (instance) body.instance = instance;
  return Object.assign(body, extensions);
}

/**
 * 도메인 에러 객체를 RFC 7807 Problem Details로 변환한다.
 *
 * @param {Error & { code?: string }} err
 * @param {{ path?: string, correlationId?: string, traceId?: string }} req
 * @returns {{ status: number, body: Record<string, unknown> }}
 */
function fromError(err, req = {}) {
  const code = err.code || inferCode(err.message || '');
  const mapping = ERROR_MAP[code] || ERROR_MAP.INTERNAL_ERROR;

  const extensions = {};
  if (req.correlationId) extensions.correlationId = req.correlationId;
  if (req.traceId)       extensions.traceId       = req.traceId;

  // 하위 호환 확장 필드 (RFC 7807 §3.2: 추가 멤버 허용)
  extensions.code           = code;                              // 도메인 오류 코드
  if (req.correlationId) {
    extensions.correlationId  = req.correlationId;               // camelCase (task-tracking 관례)
    extensions.correlation_id = req.correlationId;               // snake_case (billing 관례)
  }

  const body = createProblem({
    type:       `${BASE_URI}/${mapping.slug}`,
    title:      mapping.title,
    status:     mapping.status,
    detail:     err.message || '알 수 없는 오류가 발생했습니다.',
    instance:   req.path   || null,
    extensions,
  });

  return { status: mapping.status, body };
}

/** 메시지에서 에러 코드를 추론한다 (message-based fallback). */
function inferCode(message) {
  // ── NOT_FOUND ────────────────────────────────────────────────────────────
  if (message.includes('찾을 수 없습니다'))       return 'NOT_FOUND';
  // ── CONFLICT (상태 전이 / 불변조건 위반) ────────────────────────────────
  if (message.includes('[INV002]'))               return 'CONFLICT';
  if (message.includes('INV-V002'))               return 'CONFLICT';  // video 상태 전이
  if (message.includes('INV-V004'))               return 'CONFLICT';  // video RUNNING Job 중복
  if (message.includes('INV-B002'))               return 'CONFLICT';  // billing terminal 상태
  if (message.includes('INV-B005'))               return 'CONFLICT';  // billing 이중 승인/거부
  if (message.includes('역전이'))                 return 'CONFLICT';
  if (message.includes('DONE 상태 작업은'))        return 'CONFLICT';
  if (message.includes('이미 처리된'))             return 'CONFLICT';  // billing exception 이중처리
  if (message.includes('전이는 허용되지 않는다'))   return 'CONFLICT';  // 상태기계 위반
  // ── VALIDATION_ERROR ────────────────────────────────────────────────────
  if (message.includes('[INV001]'))               return 'VALIDATION_ERROR';
  if (message.includes('[INV003]'))               return 'VALIDATION_ERROR';
  if (message.includes('INV-V001'))               return 'VALIDATION_ERROR';  // video 필수 필드
  if (message.includes('INV-V005'))               return 'VALIDATION_ERROR';  // video 렌디션 ref 필수
  if (message.includes('INV-B004'))               return 'VALIDATION_ERROR';  // billing 금액 > 0
  if (message.includes('필수입니다'))              return 'VALIDATION_ERROR';
  if (message.includes('초과할 수 없습니다'))       return 'VALIDATION_ERROR';
  if (message.includes('이후여야 합니다'))          return 'VALIDATION_ERROR';
  if (message.includes('유효하지 않은'))           return 'VALIDATION_ERROR';  // 무효 열거값
  // ── FORBIDDEN ───────────────────────────────────────────────────────────
  if (message.includes('권한이 없습니다'))          return 'FORBIDDEN';
  if (message.includes('INV-V003'))               return 'FORBIDDEN';  // video PRIVATE 접근
  return 'INTERNAL_ERROR';
}

module.exports = { createProblem, fromError, BASE_URI, ERROR_MAP };
