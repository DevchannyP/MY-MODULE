'use strict';

class TransitionTaskStatusUseCase {
  constructor(taskRepository) {
    this._repo = taskRepository;
  }

  async execute({ task_id, new_status }) {
    const task = await this._repo.findById(task_id);
    if (!task) throw new Error(`작업을 찾을 수 없습니다: ${task_id}`);

    const oldStatus = task.status;
    task.transitionTo(new_status); // INV002는 Task 내부에서 throw
    await this._repo.save(task);
    task.pullDomainEvents(); // [확인 필요] 이벤트 버스 연동 필요

    return { task_id, old_status: oldStatus, new_status: task.status };
  }
}

module.exports = { TransitionTaskStatusUseCase };
