// @ts-check
'use strict';

/** @typedef {import('../../domain/entities/Task').Task} Task */
/** @typedef {{ assignee_id?: string, status?: string, due_before?: string, page?: number, page_size?: number }} TaskFilters */

/**
 * TaskRepository 포트 (인터페이스 정의)
 * 도메인 레이어는 이 인터페이스만 알고, 구체적인 구현(DB 등)은 모른다. (C002)
 * 구현체는 infrastructure/ 에 위치한다.
 */
class TaskRepository {
  /**
   * @param {Task} _task
   * @returns {Promise<Task>}
   */
  async save(_task)            { throw new Error('TaskRepository.save() 미구현'); }

  /**
   * @param {string} _taskId
   * @returns {Promise<Task|null>}
   */
  async findById(_taskId)      { throw new Error('TaskRepository.findById() 미구현'); }

  /**
   * @param {TaskFilters} [_filters]
   * @returns {Promise<{items: Task[], total: number}>}
   */
  async findAll(_filters)      { throw new Error('TaskRepository.findAll() 미구현'); }
}

module.exports = { TaskRepository };
