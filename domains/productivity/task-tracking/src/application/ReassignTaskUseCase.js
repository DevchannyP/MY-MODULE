'use strict';

const { TaskDomainService } = require('../domain/services/TaskDomainService');

class ReassignTaskUseCase {
  /**
   * @param {import('./ports/TaskRepository').TaskRepository} taskRepository
   * @param {import('../../../../../src/shared/EventPublisher').EventPublisher} [eventPublisher]
   */
  constructor(taskRepository, eventPublisher = null) {
    this._repo      = taskRepository;
    this._publisher = eventPublisher;
  }

  async execute({ task_id, new_assignee_id }, caller) {
    if (!caller?.permissions?.includes('task:write')) {
      throw Object.assign(new Error('Forbidden: task:write 권한이 필요합니다'), { code: 'FORBIDDEN' });
    }
    const task = await this._repo.findById(task_id);
    if (!task) throw Object.assign(new Error(`작업을 찾을 수 없습니다: ${task_id}`), { code: 'NOT_FOUND' });

    if (!TaskDomainService.canReassign(task)) {
      throw Object.assign(
        new Error('DONE 상태 작업은 담당자를 변경할 수 없습니다.'),
        { code: 'CONFLICT' },
      );
    }

    const updated = task.reassign(new_assignee_id); // INV001은 Task 내부에서 throw
    await this._repo.save(updated);
    const events = updated.pullDomainEvents();
    if (this._publisher && events.length > 0) {
      await this._publisher.publish(events);
    }

    return updated.toSnapshot();
  }
}

module.exports = { ReassignTaskUseCase };
