'use strict';

const { TaskDomainService } = require('../domain/services/TaskDomainService');

class ReassignTaskUseCase {
  constructor(taskRepository) {
    this._repo = taskRepository;
  }

  async execute({ task_id, new_assignee_id }) {
    const task = await this._repo.findById(task_id);
    if (!task) throw Object.assign(new Error(`작업을 찾을 수 없습니다: ${task_id}`), { code: 'NOT_FOUND' });

    if (!TaskDomainService.canReassign(task)) {
      throw Object.assign(
        new Error('DONE 상태 작업은 담당자를 변경할 수 없습니다.'),
        { code: 'CONFLICT' },
      );
    }

    task.reassign(new_assignee_id); // INV001은 Task 내부에서 throw
    await this._repo.save(task);
    task.pullDomainEvents(); // [확인 필요] 이벤트 버스 연동 필요

    return task.toSnapshot();
  }
}

module.exports = { ReassignTaskUseCase };
