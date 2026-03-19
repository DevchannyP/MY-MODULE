//@ts-check
'use strict';

/**
 * EventPublisher — 도메인 이벤트 발행 포트 + 어댑터
 *
 * Benchmark:
 *   - Transactional Outbox Pattern (Chris Richardson, microservices.io)
 *     도메인 이벤트를 DB 트랜잭션 안에서 outbox에 함께 저장 → relay가 broker로 전달
 *   - CloudEvents v1.0 (CNCF) 봉투 형식
 *     source, type, specversion, id, time 필드 준수
 *
 * 계층:
 *   EventPublisher (포트 인터페이스)
 *   ├── InMemoryEventPublisher  (단위 테스트용, 즉시 in-process 발행)
 *   └── OutboxEventPublisher    (프로덕션용 stub — DB 트랜잭션 outbox 패턴)
 */

const { randomUUID } = require('node:crypto');

// ── 포트 (도메인이 의존하는 추상) ────────────────────────────────────────────

class EventPublisher {
  /**
   * @param {Array<Record<string,unknown>>} events
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async publish(events) {
    throw new Error('EventPublisher.publish() must be implemented by an adapter.');
  }
}

// ── CloudEvents v1.0 봉투 생성 ────────────────────────────────────────────────

/**
 * 도메인 이벤트를 CloudEvents v1.0 봉투로 감싼다.
 * @param {Record<string,unknown>} domainEvent
 * @param {string} source  예: "//workflow-os/productivity/task-tracking"
 * @returns {Record<string,unknown>}
 */
function toCloudEvent(domainEvent, source) {
  const eventType = domainEvent.type || domainEvent.eventType || 'com.workflow-os.unknown.v1';
  return {
    specversion:     '1.0',
    id:              domainEvent.id ?? randomUUID(),
    source,
    type:            eventType,
    time:            domainEvent.occurredAt ?? new Date().toISOString(),
    datacontenttype: 'application/json',
    subject:         domainEvent.aggregateId ?? null,
    data:            domainEvent,
  };
}

// ── InMemoryEventPublisher (단위 테스트 / 개발 환경) ─────────────────────────

class InMemoryEventPublisher extends EventPublisher {
  constructor() {
    super();
    /** @type {Array<Record<string,unknown>>} */
    this._published = [];
  }

  /** @param {Array<Record<string,unknown>>} events */
  async publish(events) {
    const arr = Array.isArray(events) ? events : [events];
    this._published.push(...arr);
  }

  /** @returns {Array<Record<string,unknown>>} */
  get published() { return [...this._published]; }

  clear() { this._published = []; }
}

// ── OutboxEventPublisher (Transactional Outbox 패턴 stub) ────────────────────

/**
 * 프로덕션 구현 stub.
 *
 * 실제 구현 시: 도메인 Use Case가 DB 트랜잭션 안에서 outbox 테이블에 이벤트를 저장.
 * 별도의 relay process(Debezium CDC 또는 polling)가 outbox를 읽어 Kafka/RabbitMQ로 전달.
 * at-least-once delivery + idempotent consumer 패턴으로 exactly-once 효과 달성.
 */
class OutboxEventPublisher extends EventPublisher {
  constructor() {
    super();
    /** @type {Map<string, Record<string,unknown>>} */
    this._outbox = new Map();
  }

  /** @param {Array<Record<string,unknown>>} events */
  async publish(events) {
    const arr = Array.isArray(events) ? events : [events];
    const now = new Date().toISOString();
    for (const event of arr) {
      const entry = {
        id:          randomUUID(),
        event_type:  event.type || event.eventType || 'unknown',
        payload:     event,
        created_at:  now,
        delivered:   false,
      };
      this._outbox.set(entry.id, entry);
    }
  }

  /** pending 이벤트 목록 (relay process가 폴링) */
  getPending() {
    return [...this._outbox.values()].filter(e => !e.delivered);
  }

  /** relay가 broker 전달 성공 후 호출 */
  markDelivered(/** @type {string} */ id) {
    const entry = this._outbox.get(id);
    if (entry) entry.delivered = true;
  }
}

module.exports = { EventPublisher, InMemoryEventPublisher, OutboxEventPublisher, toCloudEvent };
