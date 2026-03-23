'use strict';

const { Task } = require('../domain/entities/Task');

/**
 * create-task capability 구현 (capability.yaml 1:1 매핑)
 * 선행 조건: assignee_id 필수, due_date >= 오늘 (도메인 내부에서 강제)
 *
 * EventPublisher 포트 주입으로 Transactional Outbox 패턴 지원.
 * Benchmark: microservices.io Outbox Pattern, CloudEvents v1.0
 */
class CreateTaskUseCase {
  /**
   * @param {import('./ports/TaskRepository').TaskRepository} taskRepository
   * @param {import('../../../../../src/shared/EventPublisher').EventPublisher} [eventPublisher]
   */
  constructor(taskRepository, eventPublisher = null) {
    this._repo      = taskRepository;
    this._publisher = eventPublisher;
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
    if (this._publisher && events.length > 0) {
      await this._publisher.publish(events);
    }
    return { task_id: task.id, status: task.status };
  }
}

module.exports = { CreateTaskUseCase };
