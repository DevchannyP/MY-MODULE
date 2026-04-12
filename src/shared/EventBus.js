//@ts-check
'use strict';

/**
 * EventBus — 프로세스 전역 Observer 버스 (Singleton)
 *
 * NFR: nfr_extended.design_patterns.observer
 *   "도메인 이벤트 발행/구독은 EventBus를 경유. 직접 핸들러 호출 금지."
 *
 * 설계 원칙:
 *   - Singleton: EventBus.getInstance()로만 접근 (process-wide coordinator)
 *   - 타입 기반 라우팅: subscribe(eventType, handler) → 해당 타입만 전달
 *   - 와일드카드('*') 구독: 모든 이벤트 수신
 *   - 에러 격리: 개별 핸들러 에러가 다른 핸들러 또는 publisher를 깨지 않음
 *   - 동기 in-process 실행 (async 확장 시 awaitHandlers 옵션으로 전환 가능)
 *
 * @example
 *   const bus = EventBus.getInstance();
 *   bus.subscribe('task.created', (evt) => console.log(evt));
 *   bus.publish({ type: 'task.created', aggregateId: 'T-001', ... });
 */

const WILDCARD = '*';

class EventBus {
  /** @type {EventBus | null} */
  static _instance = null;

  constructor() {
    if (EventBus._instance !== null) {
      throw new Error('EventBus is a Singleton — use EventBus.getInstance()');
    }
    /**
     * 핸들러 레지스트리
     * @type {Map<string, Set<Function>>}
     */
    this._handlers = new Map();
    /** @type {Array<Record<string, unknown>>} */
    this._publishedHistory = [];
    this._recordHistory = false;
  }

  /**
   * 프로세스 전역 인스턴스 반환.
   * @returns {EventBus}
   */
  static getInstance() {
    if (!EventBus._instance) {
      EventBus._instance = new EventBus();
    }
    return EventBus._instance;
  }

  /**
   * 테스트 전용: 인스턴스를 완전히 초기화한다.
   * 프로덕션 코드에서 호출 금지.
   */
  static _resetForTest() {
    EventBus._instance = null;
  }

  // ── Subscribe / Unsubscribe ─────────────────────────────────────────────────

  /**
   * 이벤트 타입 또는 와일드카드('*')에 핸들러를 등록한다.
   * @param {string} eventType  예: 'task.created', 'billing.invoice.paid', '*'
   * @param {Function} handler
   * @returns {() => void} unsubscribe 함수 반환
   */
  subscribe(eventType, handler) {
    if (typeof eventType !== 'string' || !eventType.trim()) {
      throw new TypeError('EventBus.subscribe: eventType must be a non-empty string');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('EventBus.subscribe: handler must be a function');
    }

    if (!this._handlers.has(eventType)) {
      this._handlers.set(eventType, new Set());
    }
    this._handlers.get(eventType).add(handler);

    return () => this.unsubscribe(eventType, handler);
  }

  /**
   * 핸들러 등록 해제.
   * @param {string} eventType
   * @param {Function} handler
   */
  unsubscribe(eventType, handler) {
    const set = this._handlers.get(eventType);
    if (set) {
      set.delete(handler);
      if (set.size === 0) this._handlers.delete(eventType);
    }
  }

  // ── Publish ─────────────────────────────────────────────────────────────────

  /**
   * 단일 이벤트를 발행한다.
   * handler 에러는 격리되어 다른 핸들러와 publisher에 전파되지 않는다.
   * @param {Record<string, unknown>} event  반드시 `type` 필드를 포함해야 함
   */
  publish(event) {
    if (!event || typeof event.type !== 'string') {
      throw new TypeError('EventBus.publish: event must have a string `type` field');
    }

    if (this._recordHistory) {
      this._publishedHistory.push(event);
    }

    const errors = [];
    const targets = [
      ...(this._handlers.get(event.type) ?? []),
      ...(this._handlers.get(WILDCARD) ?? []),
    ];

    for (const handler of targets) {
      try {
        handler(event);
      } catch (err) {
        errors.push({ handler: handler.name || '(anonymous)', error: err });
      }
    }

    if (errors.length > 0) {
      // 에러 격리 보장 후 경고 로그 (publisher는 이미 성공)
      for (const { handler: name, error } of errors) {
        // eslint-disable-next-line no-console
        console.warn(`[EventBus] handler "${name}" threw:`, error);
      }
    }
  }

  /**
   * 이벤트 배열을 순서대로 발행한다.
   * @param {Array<Record<string, unknown>>} events
   */
  publishAll(events) {
    if (!Array.isArray(events)) {
      throw new TypeError('EventBus.publishAll: events must be an Array');
    }
    for (const event of events) {
      this.publish(event);
    }
  }

  // ── 유틸리티 ────────────────────────────────────────────────────────────────

  /**
   * 등록된 핸들러 수 (특정 타입 또는 전체).
   * @param {string} [eventType]
   * @returns {number}
   */
  listenerCount(eventType) {
    if (eventType) {
      return this._handlers.get(eventType)?.size ?? 0;
    }
    let total = 0;
    for (const set of this._handlers.values()) total += set.size;
    return total;
  }

  /**
   * 테스트 전용: 이벤트 히스토리 기록 활성화.
   */
  enableHistory() {
    this._recordHistory = true;
  }

  /**
   * @returns {Array<Record<string, unknown>>} 발행된 이벤트 복사본
   */
  getHistory() {
    return [...this._publishedHistory];
  }

  /**
   * 테스트 전용: 핸들러와 히스토리를 모두 지운다 (인스턴스는 유지).
   */
  clearForTest() {
    this._handlers.clear();
    this._publishedHistory = [];
    this._recordHistory = false;
  }
}

module.exports = { EventBus };
