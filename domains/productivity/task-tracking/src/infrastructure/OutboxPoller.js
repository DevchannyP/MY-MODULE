//@ts-check
'use strict';

/**
 * OutboxPoller — Transactional Outbox 패턴 relay 프로세스
 *
 * NFR: nfr_extended.concurrency.model (async-first)
 *   delivered=0 행을 주기적으로 polling → EventBus publish → delivered=1
 *
 * 설계 원칙:
 *   - setInterval 기반 polling (간격 기본 500ms, 설정 가능)
 *   - 단일 polling 루프 — 동시 실행 방지를 위해 _running 플래그 사용
 *   - EventBus는 외부에서 주입 (DI) — 테스트 교체 가능
 *   - 에러 격리: 개별 이벤트 처리 실패가 다른 이벤트와 poller를 깨지 않음
 *
 * @example
 *   const poller = new OutboxPoller({ outboxRepo, eventBus });
 *   poller.start();
 *   // later:
 *   await poller.stop();
 */

class OutboxPoller {
  /**
   * @param {{
   *   outboxRepo: import('./OutboxRepository').OutboxRepository,
   *   eventBus: { publish: (event: Record<string,unknown>) => void },
   *   intervalMs?: number,
   *   batchSize?: number,
   * }} options
   */
  constructor({ outboxRepo, eventBus, intervalMs = 500, batchSize = 50 }) {
    if (!outboxRepo || typeof outboxRepo.fetchPending !== 'function') {
      throw new TypeError('OutboxPoller: outboxRepo must implement OutboxRepository port');
    }
    if (!eventBus || typeof eventBus.publish !== 'function') {
      throw new TypeError('OutboxPoller: eventBus must have a publish(event) method');
    }

    this._outboxRepo = outboxRepo;
    this._eventBus   = eventBus;
    this._intervalMs = intervalMs;
    this._batchSize  = batchSize;
    this._timer      = null;
    this._running    = false;

    /** Stats for observability */
    this.stats = { pollCount: 0, deliveredCount: 0, errorCount: 0 };
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /** 폴링을 시작한다. 이미 실행 중이면 no-op. */
  start() {
    if (this._timer !== null) return;
    this._timer = setInterval(() => this._poll(), this._intervalMs);
  }

  /**
   * 폴링을 중지하고 진행 중인 poll 완료를 기다린다.
   * @returns {Promise<void>}
   */
  stop() {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
    // 진행 중인 poll이 완료될 때까지 짧게 대기
    return new Promise((resolve) => {
      const check = () => {
        if (!this._running) { resolve(); } else { setTimeout(check, 10); }
      };
      check();
    });
  }

  get isRunning() { return this._timer !== null; }

  // ── Poll cycle ──────────────────────────────────────────────────────────────

  async _poll() {
    if (this._running) return; // 이전 poll 아직 진행 중
    this._running = true;
    this.stats.pollCount += 1;

    try {
      const pending = await this._outboxRepo.fetchPending({ limit: this._batchSize });
      if (pending.length === 0) { return; }

      const delivered = [];
      for (const row of pending) {
        try {
          this._eventBus.publish({
            type:         row.event_type,
            aggregateId:  row.aggregate_id,
            outboxId:     row.id,
            occurredAt:   row.created_at,
            ...row.payload,
          });
          delivered.push(row.id);
          this.stats.deliveredCount += 1;
        } catch (err) {
          this.stats.errorCount += 1;
          // eslint-disable-next-line no-console
          console.warn(`[OutboxPoller] event ${row.id} publish failed:`, err);
        }
      }

      if (delivered.length > 0) {
        await this._outboxRepo.markDelivered(delivered);
      }
    } catch (err) {
      this.stats.errorCount += 1;
      // eslint-disable-next-line no-console
      console.warn('[OutboxPoller] poll cycle error:', err);
    } finally {
      this._running = false;
    }
  }
}

module.exports = { OutboxPoller };
