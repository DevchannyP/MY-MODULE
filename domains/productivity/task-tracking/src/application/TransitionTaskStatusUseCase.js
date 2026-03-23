'use strict';

class TransitionTaskStatusUseCase {
  /**
   * @param {import('./ports/TaskRepository').TaskRepository} taskRepository
   * @param {import('../../../../../src/shared/EventPublisher').EventPublisher} [eventPublisher]
   */
  constructor(taskRepository, eventPublisher = null) {
    this._repo      = taskRepository;
    this._publisher = eventPublisher;
  }

  async execute({ task_id, new_status }, caller) {
    if (!caller?.permissions?.includes('task:write')) {
      throw Object.assign(new Error('Forbidden: task:write 권한이 필요합니다'), { code: 'FORBIDDEN' });
    }
    const task = await this._repo.findById(task_id);
    if (!task) throw Object.assign(new Error(`작업을 찾을 수 없습니다: ${task_id}`), { code: 'NOT_FOUND' });

    const oldStatus  = task.status;
    const updated    = task.transitionTo(new_status); // INV002는 Task 내부에서 throw
    await this._repo.save(updated);
    const events = updated.pullDomainEvents();
    if (this._publisher && events.length > 0) {
      await this._publisher.publish(events);
    }

    return { task_id, old_status: oldStatus, new_status: updated.status };
  }
}

module.exports = { TransitionTaskStatusUseCase };
