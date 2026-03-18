'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { TaskStatus } = require('../../../src/domain/value-objects/TaskStatus');

describe('TaskStatus', () => {
  describe('생성', () => {
    test('유효한 상태로 생성된다', () => {
      assert.equal(TaskStatus.from('PENDING').value, 'PENDING');
      assert.equal(TaskStatus.from('IN_PROGRESS').value, 'IN_PROGRESS');
      assert.equal(TaskStatus.from('DONE').value, 'DONE');
      assert.equal(TaskStatus.from('CANCELLED').value, 'CANCELLED');
    });

    test('유효하지 않은 상태는 에러를 던진다', () => {
      assert.throws(() => TaskStatus.from('INVALID'), /유효하지 않은 작업 상태/);
    });
  });

  describe('상태 전이 (INV002)', () => {
    test('PENDING → IN_PROGRESS 허용', () => {
      const next = TaskStatus.PENDING.transitionTo('IN_PROGRESS');
      assert.equal(next.value, 'IN_PROGRESS');
    });

    test('PENDING → CANCELLED 허용', () => {
      const next = TaskStatus.PENDING.transitionTo('CANCELLED');
      assert.equal(next.value, 'CANCELLED');
    });

    test('IN_PROGRESS → DONE 허용', () => {
      const next = TaskStatus.IN_PROGRESS.transitionTo('DONE');
      assert.equal(next.value, 'DONE');
    });

    test('IN_PROGRESS → CANCELLED 허용', () => {
      const next = TaskStatus.IN_PROGRESS.transitionTo('CANCELLED');
      assert.equal(next.value, 'CANCELLED');
    });

    test('[INV002] DONE → IN_PROGRESS 불가', () => {
      assert.throws(() => TaskStatus.DONE.transitionTo('IN_PROGRESS'), /\[INV002\]/);
    });

    test('[INV002] CANCELLED → IN_PROGRESS 불가', () => {
      assert.throws(() => TaskStatus.CANCELLED.transitionTo('IN_PROGRESS'), /\[INV002\]/);
    });

    test('[INV002] DONE → PENDING 불가', () => {
      assert.throws(() => TaskStatus.DONE.transitionTo('PENDING'), /\[INV002\]/);
    });

    test('[INV002] DONE → CANCELLED 불가 (terminal)', () => {
      assert.throws(() => TaskStatus.DONE.transitionTo('CANCELLED'), /\[INV002\]/);
    });
  });

  describe('canTransitionTo', () => {
    test('가능한 전이는 true 반환', () => {
      assert.equal(TaskStatus.PENDING.canTransitionTo('IN_PROGRESS'), true);
    });

    test('불가능한 전이는 false 반환', () => {
      assert.equal(TaskStatus.DONE.canTransitionTo('IN_PROGRESS'), false);
    });
  });
});
