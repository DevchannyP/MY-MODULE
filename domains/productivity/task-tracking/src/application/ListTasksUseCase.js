'use strict';

class ListTasksUseCase {
  constructor(taskRepository) {
    this._repo = taskRepository;
  }

  async execute(filters = {}, caller) {
    if (!caller?.permissions?.includes('task:read')) {
      throw Object.assign(new Error('Forbidden: task:read 권한이 필요합니다'), { code: 'FORBIDDEN' });
    }
    const { assignee_id, status, due_before, page = 1, page_size = 20 } = filters;
    const { items, total } = await this._repo.findAll({ assignee_id, status, due_before, page, page_size });
    return {
      items: items.map(t => t.toSnapshot()),
      total,
      page,
      page_size,
    };
  }
}

module.exports = { ListTasksUseCase };
