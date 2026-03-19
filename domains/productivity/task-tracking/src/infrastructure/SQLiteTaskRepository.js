//@ts-check
'use strict';

/**
 * SQLiteTaskRepository — 실제 DB 영속성 어댑터
 *
 * Benchmark:
 *   - Hexagonal Architecture (Alistair Cockburn) — Repository는 도메인 포트
 *   - Node.js built-in `node:sqlite` (Node 22.5+, experimental)
 *     → 외부 런타임 의존성 없이 SQLite 사용 가능
 *   - Flyway/Liquibase 마이그레이션 원칙 — schema.sql 버전 관리
 *
 * 사용:
 *   const repo = await SQLiteTaskRepository.create('./data/tasks.db');
 *   await repo.save(task);
 *   const task = await repo.findById('task-id');
 */

const path = require('node:path');
const fs   = require('node:fs');

// Node 22.5+ built-in SQLite
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql');

class SQLiteTaskRepository {
  /** @param {object} db — node:sqlite DatabaseSync instance */
  constructor(db) {
    this._db = db;
  }

  /**
   * DB 파일을 열고 스키마를 적용한 후 인스턴스를 반환한다.
   * @param {string} [dbPath=':memory:']
   * @returns {SQLiteTaskRepository}
   */
  static create(dbPath = ':memory:') {
    if (!DatabaseSync) {
      throw new Error(
        'node:sqlite을 사용할 수 없습니다. Node.js 22.5+ 가 필요합니다. ' +
        '단위 테스트는 InMemoryTaskRepository를 사용하세요.'
      );
    }
    const db = new DatabaseSync(dbPath);
    // Migrate: apply schema.sql
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);
    return new SQLiteTaskRepository(db);
  }

  /**
   * @param {import('../domain/entities/Task').Task} task
   * @returns {Promise<void>}
   */
  async save(task) {
    const snap = task.toSnapshot ? task.toSnapshot() : task;
    this._db.prepare(`
      INSERT INTO tasks (id, title, assignee_id, status, due_date, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title       = excluded.title,
        assignee_id = excluded.assignee_id,
        status      = excluded.status,
        due_date    = excluded.due_date,
        description = excluded.description,
        updated_at  = excluded.updated_at
    `).run(
      snap.id,
      snap.title,
      snap.assignee_id,
      snap.status,
      snap.due_date ?? null,
      snap.description ?? null,
      snap.created_at,
      snap.updated_at,
    );
  }

  /**
   * @param {string} id
   * @returns {Promise<import('../domain/entities/Task').Task | null>}
   */
  async findById(id) {
    const { Task } = require('../domain/entities/Task');
    const row = this._db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!row) return null;
    return Task.reconstitute(row);
  }

  /**
   * @param {{ assignee_id?: string, status?: string, page?: number, page_size?: number }} filters
   * @returns {Promise<{ items: Array<import('../domain/entities/Task').Task>, total: number }>}
   */
  async findAll({ assignee_id, status, page = 1, page_size = 20 } = {}) {
    const { Task } = require('../domain/entities/Task');

    let where = 'WHERE 1=1';
    const params = [];
    if (assignee_id) { where += ' AND assignee_id = ?'; params.push(assignee_id); }
    if (status)      { where += ' AND status = ?';      params.push(status); }

    const total = this._db.prepare(`SELECT COUNT(*) as c FROM tasks ${where}`)
      .get(...params).c;

    const offset = (page - 1) * page_size;
    const rows = this._db.prepare(
      `SELECT * FROM tasks ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, page_size, offset);

    return { items: rows.map(r => Task.reconstitute(r)), total };
  }

  /**
   * 연결을 닫는다 (테스트 정리용).
   */
  close() {
    this._db.close();
  }
}

module.exports = { SQLiteTaskRepository };
