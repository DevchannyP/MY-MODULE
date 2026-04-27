//@ts-check
'use strict';

/**
 * OutboxRepository — Transactional Outbox 패턴 Port + 어댑터
 *
 * NFR: nfr_extended.concurrency.thread_safety
 *   "Repository 구현체는 동시 읽기 안전, 쓰기는 낙관적 잠금 또는 직렬화."
 *
 * 계층:
 *   OutboxRepository (Port — 도메인 코어가 참조하는 추상)
 *   ├── InMemoryOutboxRepository  (단위 테스트 / 개발)
 *   └── SQLiteOutboxRepository   (프로덕션 — task_outbox 테이블 사용)
 *
 * task_outbox 스키마 (schema.sql):
 *   id          TEXT PRIMARY KEY
 *   event_type  TEXT NOT NULL
 *   aggregate_id TEXT NOT NULL
 *   payload     TEXT NOT NULL  (JSON CloudEvents envelope)
 *   created_at  TEXT NOT NULL  (ISO 8601)
 *   delivered   INTEGER NOT NULL DEFAULT 0  (0=pending, 1=delivered)
 *
 * 인덱스: idx_outbox_pending ON task_outbox(delivered, created_at) WHERE delivered = 0
 */

const { randomUUID } = require('node:crypto');

// ── Port (추상 인터페이스) ────────────────────────────────────────────────────

class OutboxRepository {
  /**
   * pending 이벤트를 outbox에 저장한다.
   * @param {Array<{ event_type: string, aggregate_id: string, payload: Record<string,unknown> }>} entries
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async append(entries) {
    throw new Error('OutboxRepository.append() must be implemented');
  }

  /**
   * delivered=0 행을 최대 limit개 반환한다 (created_at ASC).
   * @param {{ limit?: number }} [opts]
   * @returns {Promise<Array<{ id: string, event_type: string, aggregate_id: string, payload: Record<string,unknown>, created_at: string }>>}
   */
  // eslint-disable-next-line no-unused-vars
  async fetchPending(opts) {
    throw new Error('OutboxRepository.fetchPending() must be implemented');
  }

  /**
   * 전달 완료 처리 (delivered=1).
   * @param {string[]} ids
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async markDelivered(ids) {
    throw new Error('OutboxRepository.markDelivered() must be implemented');
  }
}

// ── InMemoryOutboxRepository ────────────────────────────────────────────────

class InMemoryOutboxRepository extends OutboxRepository {
  constructor() {
    super();
    /** @type {Map<string, { id: string, event_type: string, aggregate_id: string, payload: Record<string,unknown>, created_at: string, delivered: boolean }>} */
    this._store = new Map();
  }

  async append(entries) {
    const now = new Date().toISOString();
    for (const entry of entries) {
      const id = randomUUID();
      this._store.set(id, {
        id,
        event_type:   entry.event_type,
        aggregate_id: entry.aggregate_id,
        payload:      entry.payload,
        created_at:   now,
        delivered:    false,
      });
    }
  }

  async fetchPending({ limit = 50 } = {}) {
    const rows = [...this._store.values()]
      .filter((r) => !r.delivered)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, limit);
    return rows.map(({ id, event_type, aggregate_id, payload, created_at }) =>
      ({ id, event_type, aggregate_id, payload, created_at }));
  }

  async markDelivered(ids) {
    for (const id of ids) {
      const row = this._store.get(id);
      if (row) row.delivered = true;
    }
  }

  /** 테스트 유틸: 전체 항목 반환 */
  all() { return [...this._store.values()]; }
}

// ── SQLiteOutboxRepository ──────────────────────────────────────────────────

/**
 * node:sqlite DatabaseSync 기반 구현체.
 * 동일 DatabaseSync 인스턴스(SQLiteTaskRepository._db)를 공유해
 * 도메인 이벤트와 Task 저장을 같은 트랜잭션에서 처리할 수 있다.
 */
class SQLiteOutboxRepository extends OutboxRepository {
  /** @param {object} db — node:sqlite DatabaseSync instance */
  constructor(db) {
    super();
    this._db = db;
  }

  async append(entries) {
    const now = new Date().toISOString();
    const stmt = this._db.prepare(
      'INSERT INTO task_outbox (id, event_type, aggregate_id, payload, created_at, delivered) VALUES (?, ?, ?, ?, ?, 0)'
    );
    for (const entry of entries) {
      stmt.run(randomUUID(), entry.event_type, entry.aggregate_id, JSON.stringify(entry.payload), now);
    }
  }

  async fetchPending({ limit = 50 } = {}) {
    const rows = this._db.prepare(
      'SELECT id, event_type, aggregate_id, payload, created_at FROM task_outbox WHERE delivered = 0 ORDER BY created_at ASC LIMIT ?'
    ).all(limit);
    return rows.map((r) => ({
      id:           r.id,
      event_type:   r.event_type,
      aggregate_id: r.aggregate_id,
      payload:      JSON.parse(r.payload),
      created_at:   r.created_at,
    }));
  }

  async markDelivered(ids) {
    if (!ids.length) return;
    const placeholders = ids.map(() => '?').join(',');
    this._db.prepare(
      `UPDATE task_outbox SET delivered = 1 WHERE id IN (${placeholders})`
    ).run(...ids);
  }
}

module.exports = { OutboxRepository, InMemoryOutboxRepository, SQLiteOutboxRepository };
