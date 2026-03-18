'use strict';

class GetTaskUseCase {
  constructor(taskRepository) {
    this._repo = taskRepository;
  }

  async execute({ task_id }) {
    const task = await this._repo.findById(task_id);
    if (!task) throw new Error(`작업을 찾을 수 없습니다: ${task_id}`);
    return task.toSnapshot();
  }
}

module.exports = { GetTaskUseCase };
