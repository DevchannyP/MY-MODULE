'use strict';

class GetTaskUseCase {
  constructor(taskRepository) {
    this._repo = taskRepository;
  }

  async execute({ task_id }, caller) {
    if (!caller?.permissions?.includes('task:read')) {
      throw Object.assign(new Error('Forbidden: task:read 권한이 필요합니다'), { code: 'FORBIDDEN' });
    }
    const task = await this._repo.findById(task_id);
    if (!task) throw Object.assign(new Error(`작업을 찾을 수 없습니다: ${task_id}`), { code: 'NOT_FOUND' });
    return task.toSnapshot();
  }
}

module.exports = { GetTaskUseCase };
