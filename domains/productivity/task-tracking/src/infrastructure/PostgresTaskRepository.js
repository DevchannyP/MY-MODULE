//@ts-check
'use strict';

const { TaskRepository } = require('../application/ports/TaskRepository');

/**
 * PostgresTaskRepository — PostgreSQL 영속성 어댑터 스켈레톤
 *
 * 목표:
 *   - 도메인 포트(TaskRepository)를 그대로 구현한다.
 *   - 실제 pg Pool/Client 연결은 외부에서 주입한다.
 *   - WP-S18-001 범위에서는 실 DB 없이 구조 테스트만 가능해야 한다.
 *
 * 주입 계약:
 *   client.query(sql, params) -> Promise<{ rows?: any[], rowCount?: number }>
 */
class PostgresTaskRepository extends TaskRepository {
  /**
   * @param {{
   *   client: { query: (sql: string, params?: unknown[]) => Promise<{ rows?: any[], rowCount?: number }> },
   *   schema?: string,
   *   table?: string,
   * }} deps
   */
  constructor({ client, schema = 'public', table = 'tasks' }) {
    super();

    if (!client || typeof client.query !== 'function') {
      throw new TypeError('PostgresTaskRepository는 client.query(sql, params) 주입이 필요합니다.');
    }

    this._client = client;
    this._schema = String(schema || 'public');
    this._table = String(table || 'tasks');
  }

  _qualifiedTable() {
    return `${this._schema}.${this._table}`;
  }

  /**
   * @param {import('../domain/entities/Task').Task} task
   * @returns {Promise<import('../domain/entities/Task').Task>}
   */
  async save(task) {
    const snapshot = task.toSnapshot ? task.toSnapshot() : task;
    const existing = await this.findById(snapshot.id);

    if (existing) {
      const expectedVersion = existing.version + 1;
      if (snapshot.version !== expectedVersion) {
        throw Object.assign(
          new Error(
            `Optimistic lock conflict for task ${snapshot.id}: ` +
            `expected version ${expectedVersion}, got ${snapshot.version}`
          ),
          {
            code: 'OPTIMISTIC_LOCK_CONFLICT',
            expected: expectedVersion,
            actual: snapshot.version,
          },
        );
      }

      const sql = `
        UPDATE ${this._qualifiedTable()}
        SET
          title = $1,
          assignee_id = $2,
          status = $3,
          due_date = $4,
          description = $5,
          updated_at = $6,
          version = $7
        WHERE id = $8
      `;
      await this._client.query(sql, [
        snapshot.title,
        snapshot.assignee_id,
        snapshot.status,
        snapshot.due_date ?? null,
        snapshot.description ?? null,
        snapshot.updated_at,
        snapshot.version,
        snapshot.id,
      ]);
      return task;
    }

    const sql = `
      INSERT INTO ${this._qualifiedTable()} (
        id, title, assignee_id, status, due_date, description, created_at, updated_at, version
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;
    await this._client.query(sql, [
      snapshot.id,
      snapshot.title,
      snapshot.assignee_id,
      snapshot.status,
      snapshot.due_date ?? null,
      snapshot.description ?? null,
      snapshot.created_at,
      snapshot.updated_at,
      snapshot.version,
    ]);
    return task;
  }

  /**
   * @param {string} taskId
   * @returns {Promise<import('../domain/entities/Task').Task|null>}
   */
  async findById(taskId) {
    const { Task } = require('../domain/entities/Task');
    const sql = `
      SELECT id, title, assignee_id, status, due_date, description, created_at, updated_at, version
      FROM ${this._qualifiedTable()}
      WHERE id = $1
      LIMIT 1
    `;
    const result = await this._client.query(sql, [taskId]);
    const row = Array.isArray(result?.rows) ? result.rows[0] : null;
    return row ? Task.reconstitute(row) : null;
  }

  /**
   * @param {{ assignee_id?: string, status?: string, due_before?: string, page?: number, page_size?: number }} [filters]
   * @returns {Promise<{ items: Array<import('../domain/entities/Task').Task>, total: number }>}
   */
  async findAll({ assignee_id, status, due_before, page = 1, page_size = 20 } = {}) {
    const { Task } = require('../domain/entities/Task');

    const whereClauses = ['1=1'];
    const params = [];
    let index = 1;

    if (assignee_id) {
      whereClauses.push(`assignee_id = $${index++}`);
      params.push(assignee_id);
    }
    if (status) {
      whereClauses.push(`status = $${index++}`);
      params.push(status);
    }
    if (due_before) {
      whereClauses.push(`due_date < $${index++}`);
      params.push(due_before);
    }

    const whereSql = `WHERE ${whereClauses.join(' AND ')}`;
    const totalSql = `SELECT COUNT(*)::int AS total FROM ${this._qualifiedTable()} ${whereSql}`;
    const totalResult = await this._client.query(totalSql, params);
    const totalRow = Array.isArray(totalResult?.rows) ? totalResult.rows[0] : null;
    const total = Number(totalRow?.total || 0);

    const offset = (page - 1) * page_size;
    const limitPlaceholder = index;
    const offsetPlaceholder = index + 1;
    const listSql = `
      SELECT id, title, assignee_id, status, due_date, description, created_at, updated_at, version
      FROM ${this._qualifiedTable()}
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${limitPlaceholder}
      OFFSET $${offsetPlaceholder}
    `;
    const listResult = await this._client.query(listSql, [...params, page_size, offset]);
    const rows = Array.isArray(listResult?.rows) ? listResult.rows : [];

    return {
      items: rows.map((row) => Task.reconstitute(row)),
      total,
    };
  }
}

module.exports = { PostgresTaskRepository };
