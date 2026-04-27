'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Task } = require('../../../src/domain/entities/Task');

// 오늘 이후 날짜 헬퍼
function futureDate(daysFromNow = 1) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function pastDate() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

describe('Task.create()', () => {
  test('정상 생성 — 필수 필드만', () => {
    const task = Task.create({ title: '테스트 작업', assignee_id: 'user-1' });
    assert.equal(task.title, '테스트 작업');
    assert.equal(task.assignee_id, 'user-1');
    assert.equal(task.status, 'PENDING');
    assert.ok(task.id.startsWith('task-'));
  });

  test('정상 생성 — 선택 필드 포함', () => {
    const due = futureDate(7);
    const task = Task.create({ title: '전체 필드 작업', assignee_id: 'user-2', due_date: due, description: '설명' });
    assert.equal(task.due_date, due);
    assert.equal(task.description, '설명');
  });

  test('[INV001] 담당자 없이 생성 불가', () => {
    assert.throws(() => Task.create({ title: '제목' }), /\[INV001\]/);
  });

  test('[INV001] 빈 담당자로 생성 불가', () => {
    assert.throws(() => Task.create({ title: '제목', assignee_id: '  ' }), /\[INV001\]/);
  });

  test('[INV003] 과거 마감일로 생성 불가', () => {
    assert.throws(
      () => Task.create({ title: '제목', assignee_id: 'u1', due_date: pastDate() }),
      /\[INV003\]/
    );
  });

  test('제목 빈 문자열 불가', () => {
    assert.throws(() => Task.create({ title: '', assignee_id: 'u1' }), /제목/);
  });

  test('제목 200자 초과 불가', () => {
    assert.throws(() => Task.create({ title: 'a'.repeat(201), assignee_id: 'u1' }), /200자/);
  });

  test('설명 2000자 초과 불가', () => {
    assert.throws(() => Task.create({ title: '제목', assignee_id: 'u1', description: 'x'.repeat(2001) }), /2000자/);
  });

  test('생성 시 TaskCreated 도메인 이벤트 발행', () => {
    const task = Task.create({ title: '이벤트 확인', assignee_id: 'u1' });
    const events = task.pullDomainEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, 'TaskCreated');
    assert.equal(events[0].payload.status, 'PENDING');
  });

  test('pullDomainEvents 후 이벤트 목록 초기화', () => {
    const task = Task.create({ title: '이벤트 초기화', assignee_id: 'u1' });
    task.pullDomainEvents();
    const events2 = task.pullDomainEvents();
    assert.equal(events2.length, 0);
  });
});

describe('Task.transitionTo()', () => {
  test('PENDING → IN_PROGRESS 성공', () => {
    const task    = Task.create({ title: '작업', assignee_id: 'u1' });
    task.pullDomainEvents();
    const updated = task.transitionTo('IN_PROGRESS');
    assert.equal(updated.status, 'IN_PROGRESS');
    const events = updated.pullDomainEvents();
    assert.equal(events[0].event_type, 'TaskStatusChanged');
    assert.equal(events[0].payload.old_status, 'PENDING');
    assert.equal(events[0].payload.new_status, 'IN_PROGRESS');
  });

  test('IN_PROGRESS → DONE 성공', () => {
    let task = Task.create({ title: '작업', assignee_id: 'u1' });
    task = task.transitionTo('IN_PROGRESS');
    task = task.transitionTo('DONE');
    assert.equal(task.status, 'DONE');
  });

  test('[INV002] DONE → IN_PROGRESS 불가', () => {
    let task = Task.create({ title: '작업', assignee_id: 'u1' });
    task = task.transitionTo('IN_PROGRESS');
    task = task.transitionTo('DONE');
    assert.throws(() => task.transitionTo('IN_PROGRESS'), /\[INV002\]/);
  });
});

describe('Task.reassign()', () => {
  test('담당자 변경 성공', () => {
    const task    = Task.create({ title: '작업', assignee_id: 'user-a' });
    task.pullDomainEvents();
    const updated = task.reassign('user-b');
    assert.equal(updated.assignee_id, 'user-b');
    const events = updated.pullDomainEvents();
    assert.equal(events[0].event_type, 'TaskReassigned');
    assert.equal(events[0].payload.old_assignee_id, 'user-a');
    assert.equal(events[0].payload.new_assignee_id, 'user-b');
  });

  test('[INV001] 빈 담당자로 변경 불가', () => {
    const task = Task.create({ title: '작업', assignee_id: 'u1' });
    assert.throws(() => task.reassign(''), /\[INV001\]/);
  });
});

describe('Task.toSnapshot()', () => {
  test('스냅샷은 모든 필드를 포함한다', () => {
    const task = Task.create({ title: '스냅샷 테스트', assignee_id: 'u1' });
    const snap = task.toSnapshot();
    assert.ok(snap.id);
    assert.equal(snap.title, '스냅샷 테스트');
    assert.equal(snap.assignee_id, 'u1');
    assert.equal(snap.status, 'PENDING');
    assert.ok(snap.created_at);
    assert.ok(snap.updated_at);
  });
});

describe('Task.reconstitute()', () => {
  test('스냅샷에서 복원된 작업은 동일한 상태를 가진다', () => {
    const created   = Task.create({ title: '복원 테스트', assignee_id: 'u1' });
    const original  = created.transitionTo('IN_PROGRESS');
    const snap      = original.toSnapshot();
    const restored  = Task.reconstitute(snap);
    assert.equal(restored.id, original.id);
    assert.equal(restored.status, 'IN_PROGRESS');
    assert.equal(restored.assignee_id, 'u1');
  });
});
