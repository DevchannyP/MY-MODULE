'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { Task } = require('../../src/domain/entities/Task');
const { PostgresTaskRepository } = require('../../src/infrastructure/PostgresTaskRepository');

class FakePgClient {
  constructor() {
    this._rows = new Map();
    this.calls = [];
  }

  async query(sql, params = []) {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();
    this.calls.push({ sql: normalized, params: [...params] });

    if (normalized.startsWith('SELECT id, title, assignee_id, status, due_date, description, created_at, updated_at, version FROM public.tasks WHERE id = $1')) {
      const row = this._rows.get(params[0]);
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }

    if (normalized.startsWith('INSERT INTO public.tasks')) {
      const [id, title, assignee_id, status, due_date, description, created_at, updated_at, version] = params;
      this._rows.set(id, {
        id,
        title,
        assignee_id,
        status,
        due_date,
        description,
        created_at,
        updated_at,
        version,
      });
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith('UPDATE public.tasks')) {
      const [title, assignee_id, status, due_date, description, updated_at, version, id] = params;
      const existing = this._rows.get(id);
      if (!existing) {
        return { rows: [], rowCount: 0 };
      }
      this._rows.set(id, {
        ...existing,
        title,
        assignee_id,
        status,
        due_date,
        description,
        updated_at,
        version,
      });
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith('SELECT COUNT(*)::int AS total FROM public.tasks')) {
      const filtered = this._filterRows(normalized, params);
      return { rows: [{ total: filtered.length }], rowCount: 1 };
    }

    if (normalized.startsWith('SELECT id, title, assignee_id, status, due_date, description, created_at, updated_at, version FROM public.tasks WHERE 1=1')) {
      const limit = params[params.length - 2];
      const offset = params[params.length - 1];
      const filtered = this._filterRows(normalized, params)
        .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
        .slice(offset, offset + limit);
      return { rows: filtered.map((row) => ({ ...row })), rowCount: filtered.length };
    }

    throw new Error(`Unexpected SQL in FakePgClient: ${normalized}`);
  }

  _filterRows(sql, params) {
    let index = 0;
    let rows = Array.from(this._rows.values());

    if (sql.includes('assignee_id = $')) {
      const assignee = params[index++];
      rows = rows.filter((row) => row.assignee_id === assignee);
    }
    if (sql.includes('status = $')) {
      const status = params[index++];
      rows = rows.filter((row) => row.status === status);
    }
    if (sql.includes('due_date < $')) {
      const dueBefore = params[index];
      rows = rows.filter((row) => row.due_date && row.due_date < dueBefore);
    }

    return rows;
  }
}

function makeRepo() {
  const client = new FakePgClient();
  return {
    client,
    repo: new PostgresTaskRepository({ client }),
  };
}

async function seedTask(repo, overrides = {}) {
  const task = Task.create({
    title: overrides.title || 'pg task',
    assignee_id: overrides.assignee_id || 'user-1',
    due_date: overrides.due_date || null,
    description: overrides.description || null,
  });
  await repo.save(task);
  return task;
}

describe('PostgresTaskRepository — 구조 계약 테스트', () => {
  test('TaskRepository 포트 메서드 save/findById/findAll을 구현한다', async () => {
    const { repo } = makeRepo();
    assert.equal(typeof repo.save, 'function');
    assert.equal(typeof repo.findById, 'function');
    assert.equal(typeof repo.findAll, 'function');
  });

  test('client.query 주입이 없으면 생성에 실패한다', () => {
    assert.throws(
      () => new PostgresTaskRepository({ client: null }),
      /client\.query/,
    );
  });

  test('save 후 findById로 동일 task를 재구성한다', async () => {
    const { repo, client } = makeRepo();
    const task = await seedTask(repo, { title: 'postgres-seeded' });

    const found = await repo.findById(task.id);
    assert.ok(found);
    assert.equal(found.id, task.id);
    assert.equal(found.title, 'postgres-seeded');
    assert.ok(client.calls.some((call) => call.sql.startsWith('INSERT INTO public.tasks')));
    assert.ok(client.calls.some((call) => call.sql.includes('WHERE id = $1 LIMIT 1')));
  });

  test('findAll은 assignee/status/due_before/page/page_size 필터를 조합한다', async () => {
    const { repo } = makeRepo();
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

    const a = await seedTask(repo, { title: 'A', assignee_id: 'user-a', due_date: tomorrow });
    const b = await seedTask(repo, { title: 'B', assignee_id: 'user-a', due_date: nextWeek });
    const c = await seedTask(repo, { title: 'C', assignee_id: 'user-b', due_date: tomorrow });

    await repo.save(a.transitionTo('IN_PROGRESS'));
    await repo.save(b.transitionTo('IN_PROGRESS'));
    void c;

    const cutoff = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const result = await repo.findAll({
      assignee_id: 'user-a',
      status: 'IN_PROGRESS',
      due_before: cutoff,
      page: 1,
      page_size: 10,
    });

    assert.equal(result.total, 1);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].title, 'A');
  });

  test('stale version save는 OPTIMISTIC_LOCK_CONFLICT를 던진다', async () => {
    const { repo } = makeRepo();
    const created = await seedTask(repo, { title: 'stale-check' });
    const advanced = created.transitionTo('IN_PROGRESS');
    await repo.save(advanced);

    const stale = Task.reconstitute({ ...advanced.toSnapshot(), version: 1 });
    await assert.rejects(
      () => repo.save(stale),
      (error) => {
        assert.equal(error.code, 'OPTIMISTIC_LOCK_CONFLICT');
        assert.equal(error.expected, 3);
        assert.equal(error.actual, 1);
        return true;
      },
    );
  });
});
