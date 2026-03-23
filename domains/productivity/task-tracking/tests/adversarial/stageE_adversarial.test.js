'use strict';

/**
 * Stage E - 적대적 검증 테스트
 * 목적: 경계 케이스, 계약 위반 시뮬레이션, 구조적 갭 발견
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { Task } = require('../../src/domain/entities/Task');
const { TaskStatus } = require('../../src/domain/value-objects/TaskStatus');
const { CreateTaskUseCase } = require('../../src/application/CreateTaskUseCase');
const { TransitionTaskStatusUseCase } = require('../../src/application/TransitionTaskStatusUseCase');
const { ReassignTaskUseCase } = require('../../src/application/ReassignTaskUseCase');
const { InMemoryTaskRepository } = require('../../src/infrastructure/InMemoryTaskRepository');

const WRITE_CALLER = { userId: 'test-user', permissions: ['task:read', 'task:write'] };

function today() { return new Date().toISOString().slice(0, 10); }

// ══════════════════════════════════════════════════════════════════════
// 1. 경계값 (Boundary Value) 테스트
// ══════════════════════════════════════════════════════════════════════
describe('[E-1] 경계값 테스트', () => {
  test('title 정확히 200자 → PASS (경계 포함)', () => {
    const title200 = 'a'.repeat(200);
    const task = Task.create({ title: title200, assignee_id: 'u1' });
    assert.equal(task.title.length, 200);
  });

  test('title 201자 → FAIL (초과)', () => {
    assert.throws(() => Task.create({ title: 'a'.repeat(201), assignee_id: 'u1' }), /200자/);
  });

  test('description 정확히 2000자 → PASS (경계 포함)', () => {
    const desc2000 = 'b'.repeat(2000);
    const task = Task.create({ title: '제목', assignee_id: 'u1', description: desc2000 });
    assert.equal(task.description.length, 2000);
  });

  test('description 2001자 → FAIL (초과)', () => {
    assert.throws(
      () => Task.create({ title: '제목', assignee_id: 'u1', description: 'b'.repeat(2001) }),
      /2000자/
    );
  });

  test('due_date = 오늘 → PASS (오늘 포함 허용)', () => {
    // capability.yaml: "due_date가 오늘 이후여야 한다" → 오늘 포함 여부 검증
    const task = Task.create({ title: '오늘 마감', assignee_id: 'u1', due_date: today() });
    assert.equal(task.due_date, today());
  });

  test('title 공백만 → FAIL (trim 후 빈 문자열)', () => {
    assert.throws(() => Task.create({ title: '   ', assignee_id: 'u1' }), /제목/);
  });

  test('assignee_id 공백만 → FAIL (trim 후 빈 문자열, INV001)', () => {
    assert.throws(() => Task.create({ title: '제목', assignee_id: '   ' }), /\[INV001\]/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2. null / undefined 방어 테스트
// ══════════════════════════════════════════════════════════════════════
describe('[E-2] null/undefined 입력 방어', () => {
  test('null assignee_id → INV001 에러', () => {
    assert.throws(() => Task.create({ title: '제목', assignee_id: null }), /\[INV001\]/);
  });

  test('undefined title → 제목 에러', () => {
    assert.throws(() => Task.create({ title: undefined, assignee_id: 'u1' }), /제목/);
  });

  test('null title → 제목 에러', () => {
    assert.throws(() => Task.create({ title: null, assignee_id: 'u1' }), /제목/);
  });

  test('due_date null → 허용 (선택 필드)', () => {
    const task = Task.create({ title: '제목', assignee_id: 'u1', due_date: null });
    assert.equal(task.due_date, null);
  });

  test('description null → 허용 (선택 필드)', () => {
    const task = Task.create({ title: '제목', assignee_id: 'u1', description: null });
    assert.equal(task.description, null);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3. 이벤트 페이로드 스키마 정합성 (계약 vs 구현)
// capability.yaml postconditions, events.schema.json required fields 확인
// ══════════════════════════════════════════════════════════════════════
describe('[E-3] 이벤트 스키마 정합성 (계약 vs 구현)', () => {
  test('TaskCreated: schema required fields [event_id, event_type, occurred_at, payload] 존재', () => {
    const task = Task.create({ title: '이벤트 검증', assignee_id: 'u1' });
    const [event] = task.pullDomainEvents();
    assert.ok(event.event_id,    'event_id 누락');
    assert.ok(event.event_type,  'event_type 누락');
    assert.ok(event.occurred_at, 'occurred_at 누락');
    assert.ok(event.payload,     'payload 누락');
    assert.equal(event.event_type, 'TaskCreated');
    assert.equal(event.payload.status, 'PENDING'); // schema: const "PENDING"
  });

  test('TaskCreated: payload required fields [task_id, title, assignee_id, status] 존재', () => {
    const task = Task.create({ title: '페이로드 검증', assignee_id: 'alice' });
    const [event] = task.pullDomainEvents();
    const p = event.payload;
    assert.ok(p.task_id,     'task_id 누락');
    assert.ok(p.title,       'title 누락');
    assert.ok(p.assignee_id, 'assignee_id 누락');
    assert.ok(p.status,      'status 누락');
    assert.equal(p.title, '페이로드 검증');
    assert.equal(p.assignee_id, 'alice');
  });

  test('TaskStatusChanged: payload required fields [task_id, old_status, new_status] 존재', () => {
    const task = Task.create({ title: '상태 이벤트', assignee_id: 'u1' });
    task.pullDomainEvents();
    task.transitionTo('IN_PROGRESS');
    const [event] = task.pullDomainEvents();
    assert.equal(event.event_type, 'TaskStatusChanged');
    assert.ok(event.payload.task_id,    'task_id 누락');
    assert.ok(event.payload.old_status, 'old_status 누락');
    assert.ok(event.payload.new_status, 'new_status 누락');
    assert.equal(event.payload.old_status, 'PENDING');
    assert.equal(event.payload.new_status, 'IN_PROGRESS');
    // schema: new_status enum [IN_PROGRESS, DONE, CANCELLED]
    assert.ok(['IN_PROGRESS', 'DONE', 'CANCELLED'].includes(event.payload.new_status));
  });

  test('TaskReassigned: payload required fields [task_id, old_assignee_id, new_assignee_id] 존재', () => {
    const task = Task.create({ title: '재할당 이벤트', assignee_id: 'user-a' });
    task.pullDomainEvents();
    task.reassign('user-b');
    const [event] = task.pullDomainEvents();
    assert.equal(event.event_type, 'TaskReassigned');
    assert.ok(event.payload.task_id,         'task_id 누락');
    assert.ok(event.payload.old_assignee_id, 'old_assignee_id 누락');
    assert.ok(event.payload.new_assignee_id, 'new_assignee_id 누락');
  });

  test('occurred_at는 ISO 8601 date-time 형식', () => {
    const task = Task.create({ title: 'ISO 검증', assignee_id: 'u1' });
    const [event] = task.pullDomainEvents();
    // ISO 8601: YYYY-MM-DDTHH:MM:SS.sssZ
    assert.match(event.occurred_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4. 계약 위반 시뮬레이션 (계약과 구현 사이의 갭 발견)
// ══════════════════════════════════════════════════════════════════════
describe('[E-4] 계약 위반 시뮬레이션 (구조적 갭)', () => {
  // [갭 발견] capability.yaml: reassign-task에 "DONE 상태 불가" invariant가 명시되지 않음
  // 코드에서는 TaskDomainService.canReassign → DONE 불가 강제
  // → capability.yaml에 invariant 추가 필요 (Stage A 재실행 트리거)
  test('[갭-1] CANCELLED 상태에서 재할당: 코드는 허용, 계약에 명시 없음 → 계약 갱신 필요', async () => {
    const repo = new InMemoryTaskRepository();
    const createUC   = new CreateTaskUseCase(repo);
    const transUC    = new TransitionTaskStatusUseCase(repo);
    const reassignUC = new ReassignTaskUseCase(repo);

    const { task_id } = await createUC.execute({ title: '취소 재할당', assignee_id: 'alice' }, WRITE_CALLER);
    await transUC.execute({ task_id, new_status: 'CANCELLED' }, WRITE_CALLER);

    // 코드 동작: canReassign → DONE만 막음, CANCELLED는 허용
    // capability.yaml invariant에 이 동작이 명시되지 않음 → 계약 갭
    const result = await reassignUC.execute({ task_id, new_assignee_id: 'bob' }, WRITE_CALLER);
    assert.equal(result.assignee_id, 'bob'); // 현재 코드: 허용됨
    // 이 테스트가 PASS라는 것이 곧 갭의 증거:
    // 계약에는 "CANCELLED 상태에서 재할당 가능"이 명시되어 있지 않다.
  });

  // [갭 수정] permissions_required가 UseCase 레이어에서 강제됨
  // capability.yaml: create-task permissions_required: ["task:write"]
  // 코드: CreateTaskUseCase가 caller 권한 검사를 수행함
  test('[갭-2 수정] 권한 없이 create-task 호출 → FORBIDDEN 에러', async () => {
    const repo = new InMemoryTaskRepository();
    const createUC = new CreateTaskUseCase(repo);
    await assert.rejects(
      () => createUC.execute({ title: '권한 없는 생성', assignee_id: 'u1' }, null),
      { code: 'FORBIDDEN' },
    );
  });

  // [갭 발견] task가 존재하지 않을 때 reassign 시도
  test('[갭-3] 존재하지 않는 task 재할당 → 적절한 에러 반환', async () => {
    const repo = new InMemoryTaskRepository();
    const reassignUC = new ReassignTaskUseCase(repo);
    await assert.rejects(
      () => reassignUC.execute({ task_id: 'ghost-task', new_assignee_id: 'bob' }, WRITE_CALLER),
      /찾을 수 없습니다/
    );
  });
});

// ══════════════════════════════════════════════════════════════════════
// 5. 동시성 / 낙관적 잠금 누락 시뮬레이션
// ══════════════════════════════════════════════════════════════════════
describe('[E-5] 동시성 및 낙관적 잠금 누락', () => {
  test('[동시성-1] 같은 task에 두 번 transitionTo 순차 실행 → 마지막 상태 보장', async () => {
    const repo = new InMemoryTaskRepository();
    const createUC = new CreateTaskUseCase(repo);
    const transUC  = new TransitionTaskStatusUseCase(repo);

    const { task_id } = await createUC.execute({ title: '순차 전이', assignee_id: 'u1' }, WRITE_CALLER);
    await transUC.execute({ task_id, new_status: 'IN_PROGRESS' }, WRITE_CALLER);

    // IN_PROGRESS에서 동시에 두 클라이언트가 DONE과 CANCELLED를 각각 시도하는 시나리오:
    // 순차 시뮬레이션 — 첫 번째 DONE 성공, 두 번째 CANCELLED는 terminal에서 throw
    const r1 = await transUC.execute({ task_id, new_status: 'DONE' }, WRITE_CALLER);
    assert.equal(r1.new_status, 'DONE');

    await assert.rejects(
      () => transUC.execute({ task_id, new_status: 'CANCELLED' }, WRITE_CALLER),
      /\[INV002\]/
    );
    // [갭 발견] 실제 동시 요청에서는 두 번째 요청이 stale read 이후 저장하면
    // 마지막 write가 이기는 lost update 문제 발생 가능.
    // InMemoryRepository는 낙관적 잠금(version field) 없음.
    // → 프로덕션 DB 전환 시 낙관적 잠금 또는 비관적 잠금 필요
  });

  test('[동시성-2] 동일 ID 재생성 시 toSnapshot이 독립적임을 확인', () => {
    const t1 = Task.create({ title: 'A', assignee_id: 'u1' });
    const snap = t1.toSnapshot();
    snap.title = '조작된 제목'; // 외부 변조 시도
    const t2 = Task.reconstitute(snap);
    assert.equal(t2.title, '조작된 제목'); // reconstitute는 snapshot을 신뢰
    // [참고] snapshot 불변성 보장이 필요한 경우 deep freeze 추가 검토
  });
});

// ══════════════════════════════════════════════════════════════════════
// 6. 상태 기계 완전성 검증 (모든 허용/불허 전이 망라)
// ══════════════════════════════════════════════════════════════════════
describe('[E-6] 상태 기계 완전성 (State Machine Exhaustive)', () => {
  const STATUSES = ['PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED'];
  const ALLOWED = {
    PENDING:     ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['DONE', 'CANCELLED'],
    DONE:        [],
    CANCELLED:   [],
  };

  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const shouldAllow = ALLOWED[from].includes(to);
      test(`${from} → ${to}: ${shouldAllow ? '허용' : '불허'}`, () => {
        const status = TaskStatus.from(from);
        if (shouldAllow) {
          const next = status.transitionTo(to);
          assert.equal(next.value, to);
        } else {
          assert.throws(() => status.transitionTo(to));
        }
      });
    }
  }
});

// ══════════════════════════════════════════════════════════════════════
// 7. 계약 capability 1:1 구현 검증
// ══════════════════════════════════════════════════════════════════════
describe('[E-7] capability.yaml ↔ UseCase 1:1 매핑 검증', () => {
  const REQUIRED_CAPABILITIES = [
    'create-task',
    'get-task',
    'list-tasks',
    'transition-task-status',
    'reassign-task',
  ];

  const USECASE_MAP = {
    'create-task':            require('../../src/application/CreateTaskUseCase').CreateTaskUseCase,
    'get-task':               require('../../src/application/GetTaskUseCase').GetTaskUseCase,
    'list-tasks':             require('../../src/application/ListTasksUseCase').ListTasksUseCase,
    'transition-task-status': require('../../src/application/TransitionTaskStatusUseCase').TransitionTaskStatusUseCase,
    'reassign-task':          require('../../src/application/ReassignTaskUseCase').ReassignTaskUseCase,
  };

  for (const capId of REQUIRED_CAPABILITIES) {
    test(`${capId} → UseCase 구현 존재`, () => {
      const UseCase = USECASE_MAP[capId];
      assert.ok(UseCase, `${capId}에 대응하는 UseCase 없음`);
      assert.equal(typeof UseCase, 'function');
      // execute 메서드 존재 확인
      const repo = new InMemoryTaskRepository();
      const uc = new UseCase(repo);
      assert.equal(typeof uc.execute, 'function');
    });
  }
});
