//@ts-check
'use strict';

/**
 * EventBusPublisher — EventPublisher 포트의 EventBus 어댑터
 *
 * 아키텍처 역할:
 *   Use Case → EventPublisher (Port) → EventBusPublisher (Adapter) → EventBus (Singleton)
 *
 * 설계 원칙:
 *   - 도메인 use case는 EventPublisher 포트만 참조 (인프라 독립)
 *   - EventBusPublisher는 포트를 구현하는 어댑터 계층에 위치
 *   - EventBus.getInstance()를 통해 프로세스 전역 버스에 이벤트 라우팅
 *   - CloudEvents v1.0 봉투 형식: event.type 필드 필수
 *
 * @example
 *   // DI 설정
 *   const publisher = new EventBusPublisher();
 *   const useCase = new CreateTaskUseCase(repo, publisher);
 *
 *   // 구독
 *   EventBus.getInstance().subscribe('TaskCreated', (evt) => console.log(evt));
 */

const { EventPublisher } = require('./EventPublisher');
const { EventBus } = require('./EventBus');

class EventBusPublisher extends EventPublisher {
  /**
   * @param {EventBus} [eventBus] — 기본값: EventBus.getInstance() (프로덕션)
   *   테스트에서 격리된 인스턴스를 주입할 때 사용.
   */
  constructor(eventBus) {
    super();
    this._bus = eventBus || EventBus.getInstance();
  }

  /**
   * 도메인 이벤트 배열을 EventBus로 발행한다.
   * event.event_type 또는 event.type 을 EventBus `type` 필드로 사용.
   *
   * @param {Array<Record<string,unknown>>} events
   * @returns {Promise<void>}
   */
  async publish(events) {
    const arr = Array.isArray(events) ? events : [events];
    for (const event of arr) {
      // domain events use event_type; CloudEvents use type — normalize to type
      const type = String(event.type || event.event_type || 'domain.unknown');
      this._bus.publish({ ...event, type });
    }
  }

  /** 현재 연결된 EventBus 인스턴스 반환 (테스트 검증용) */
  get bus() { return this._bus; }
}

module.exports = { EventBusPublisher };
