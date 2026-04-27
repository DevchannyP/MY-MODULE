'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Task } = require('../../../src/domain/entities/Task');
const { TaskDomainService } = require('../../../src/domain/services/TaskDomainService');

function futureDate(days = 1) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function pastDate() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

describe('TaskDomainService.isTerminal()', () => {
  test('DONE은 terminal', () => {
    let task = Task.create({ title: '작업', assignee_id: 'u1' });
    task = task.transitionTo('IN_PROGRESS');
    task = task.transitionTo('DONE');
    assert.equal(TaskDomainService.isTerminal(task), true);
  });

  test('CANCELLED는 terminal', () => {
    let task = Task.create({ title: '작업', assignee_id: 'u1' });
    task = task.transitionTo('CANCELLED');
    assert.equal(TaskDomainService.isTerminal(task), true);
  });

  test('PENDING은 terminal이 아님', () => {
    const task = Task.create({ title: '작업', assignee_id: 'u1' });
    assert.equal(TaskDomainService.isTerminal(task), false);
  });

  test('IN_PROGRESS는 terminal이 아님', () => {
    let task = Task.create({ title: '작업', assignee_id: 'u1' });
    task = task.transitionTo('IN_PROGRESS');
    assert.equal(TaskDomainService.isTerminal(task), false);
  });
});

describe('TaskDomainService.canReassign()', () => {
  test('PENDING 상태는 담당자 변경 가능', () => {
    const task = Task.create({ title: '작업', assignee_id: 'u1' });
    assert.equal(TaskDomainService.canReassign(task), true);
  });

  test('IN_PROGRESS 상태는 담당자 변경 가능', () => {
    let task = Task.create({ title: '작업', assignee_id: 'u1' });
    task = task.transitionTo('IN_PROGRESS');
    assert.equal(TaskDomainService.canReassign(task), true);
  });

  test('DONE 상태는 담당자 변경 불가', () => {
    let task = Task.create({ title: '작업', assignee_id: 'u1' });
    task = task.transitionTo('IN_PROGRESS');
    task = task.transitionTo('DONE');
    assert.equal(TaskDomainService.canReassign(task), false);
  });
});

describe('TaskDomainService.isOverdue()', () => {
  test('마감일 없는 작업은 초과 아님', () => {
    const task = Task.create({ title: '작업', assignee_id: 'u1' });
    assert.equal(TaskDomainService.isOverdue(task), false);
  });

  test('미래 마감일은 초과 아님', () => {
    const task = Task.create({ title: '작업', assignee_id: 'u1', due_date: futureDate(7) });
    assert.equal(TaskDomainService.isOverdue(task), false);
  });

  test('완료된 작업은 마감일 초과라도 isOverdue false', () => {
    // reconstitute로 이미 완료된 작업 (과거 마감일 포함) 생성
    const task = Task.reconstitute({
      id: 'task-x', title: '완료', assignee_id: 'u1',
      due_date: pastDate(), status: 'DONE',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    assert.equal(TaskDomainService.isOverdue(task), false);
  });
});
