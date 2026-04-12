'use strict';

const { Task } = require('../domain/entities/Task');

/**
 * create-task capability 구현 (capability.yaml 1:1 매핑)
 * 선행 조건: assignee_id 필수, due_date >= 오늘 (도메인 내부에서 강제)
 *
 * 전달 보장 전략:
 *   1. EventPublisher (직접 발행): 저지연, 프로세스 내 EventBus 라우팅
 *   2. OutboxRepository (듀얼 라이트): 영속성 보장, OutboxPoller가 재전달
 *      → 두 경로 중 하나라도 살아있으면 이벤트 도달 (at-least-once)
 *
 * Benchmark: microservices.io Outbox Pattern, CloudEvents v1.0
 */
class CreateTaskUseCase {
  /**
   * @param {import('./ports/TaskRepository').TaskRepository} taskRepository
   * @param {import('../../../../../src/shared/EventPublisher').EventPublisher} [eventPublisher]
   * @param {import('../infrastructure/OutboxRepository').OutboxRepository} [outboxRepository]
   */
  constructor(taskRepository, eventPublisher = null, outboxRepository = null) {
    this._repo    = taskRepository;
    this._publisher = eventPublisher;
    this._outbox  = outboxRepository;
  }

  /**
   * @param {{ title: string, assignee_id: string, due_date?: string, description?: string }} command
   * @param {{ userId: string, permissions: string[] }|null} caller
   * @returns {Promise<{ task_id: string, status: string }>}
   */
  async execute({ title, assignee_id, due_date, description }, caller) {
    if (!caller?.permissions?.includes('task:write')) {
      throw Object.assign(new Error('Forbidden: task:write 권한이 필요합니다'), { code: 'FORBIDDEN' });
    }
    const task = Task.create({ title, assignee_id, due_date, description });
    await this._repo.save(task);
    const events = task.pullDomainEvents();

    // 경로 1: EventBus 직접 발행 (저지연)
    if (this._publisher && events.length > 0) {
      await this._publisher.publish(events);
    }

    // 경로 2: Outbox 듀얼 라이트 (내구성 — OutboxPoller가 미전달 시 재시도)
    if (this._outbox && events.length > 0) {
      await this._outbox.append(
        events.map((e) => ({
          event_type:   e.event_type || e.type || 'domain.unknown',
          aggregate_id: task.id,
          payload:      e,
        }))
      );
    }

    return { task_id: task.id, status: task.status };
  }
}

module.exports = { CreateTaskUseCase };
