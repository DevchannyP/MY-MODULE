'use strict';

const { Task } = require('../domain/entities/Task');

/**
 * create-task capability 구현 (capability.yaml 1:1 매핑)
 * 선행 조건: assignee_id 필수, due_date >= 오늘 (도메인 내부에서 강제)
 */
class CreateTaskUseCase {
  /** @param {import('./ports/TaskRepository').TaskRepository} taskRepository */
  constructor(taskRepository) {
    this._repo = taskRepository;
  }

  /**
   * @param {{ title: string, assignee_id: string, due_date?: string, description?: string }} command
   * @returns {Promise<{ task_id: string, status: string }>}
   */
  async execute({ title, assignee_id, due_date, description }) {
    const task = Task.create({ title, assignee_id, due_date, description });
    await this._repo.save(task);
    const events = task.pullDomainEvents();
    // [확인 필요] 이벤트 버스 연동: events를 외부 이벤트 브로커로 발행하는 로직 필요
    return { task_id: task.id, status: task.status, _events: events };
  }
}

module.exports = { CreateTaskUseCase };
