'use strict';

class ListTasksUseCase {
  constructor(taskRepository) {
    this._repo = taskRepository;
  }

  async execute({ assignee_id, status, due_before, page = 1, page_size = 20 } = {}) {
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
