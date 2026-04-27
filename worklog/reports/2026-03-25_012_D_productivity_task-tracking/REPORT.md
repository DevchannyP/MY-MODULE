# 학습 보고서: Stage D — productivity/task-tracking

> 일자: 2026-03-25 | 순번: #012 | 작성: AI Agent (reporter)
> Stage: D | 도메인: productivity/task-tracking
> 게이트 결과: PASS | 테스트: 23/23 authz PASS, TaskController 5경로

---

## 기(起) — 배경과 문제 정의

task-tracking은 Stage D의 **기준 사례(reference implementation)**다. billing의 금융 복잡성도, video의 비동기 파이프라인도 없다. 오히려 그 단순함이 이 도메인을 파이프라인의 기준이 되게 한다.

Stage D의 핵심 도전은:
1. **TaskController.js 구현** (ADR-0002 이행): permissions_required UseCase 미강제 갭(GAP-002)을 Controller 레이어에서 해결.
2. **23/23 authz 회귀 테스트 PASS**: 5개 경로에 대한 역할-경로-예상결과 매핑 완전 커버.
3. **SQLiteTaskRepository `due_before` 필터 누락 수정**: 쿼리 필터가 계약에는 있지만 구현에서 빠진 드리프트 케이스.

### 핵심 용어
| 용어 | 한글 | 의미 |
|------|------|------|
| Controller layer | 인터페이스 레이어 | HTTP 요청을 UseCase로 위임하는 최외곽 레이어 |
| ADR-0002 | 권한 강제 결정 | 권한 검증을 UseCase가 아닌 Controller 레이어에서 수행 결정 |
| due_before | 기한 이전 필터 | listTasks 쿼리의 날짜 범위 필터. capability.yaml에 명시된 파라미터 |
| INV004 | DONE 담당자 변경 금지 | Stage E에서 소급 발견. capability.yaml에 추가됨 |

---

## 승(承) — 설계 결정

### ADR-0002: 권한 강제 레이어 결정

GAP-002(permissions_required UseCase 미강제)에 대한 구조적 해결책으로 ADR-0002를 결정했다.

**결정**: 권한 검증은 Controller 레이어에서 수행한다. UseCase는 도메인 로직만 담당.

**이유**:
- UseCase에 권한 코드가 섞이면 단위 테스트 시 항상 권한 컨텍스트를 목(mock)해야 한다.
- Controller → UseCase 경계가 "권한 통과 후 도메인 실행"을 명확히 분리.
- 새 경로 추가 시 권한 매트릭스만 업데이트하면 된다.

### SQLiteTaskRepository `due_before` 필터 드리프트 수정

계약(capability.yaml의 `list-tasks` 쿼리)에는 `due_before` 파라미터가 명시되어 있었지만 SQLite 구현에서 WHERE 절이 누락되어 있었다.

```javascript
// 수정 전: due_before 무시
const rows = await this._db.all(`SELECT * FROM tasks WHERE assignee_id = ?`, [assigneeId]);

// 수정 후: due_before 필터 적용
let query = `SELECT * FROM tasks WHERE 1=1`;
const params = [];
if (filters.assigneeId) { query += ` AND assignee_id = ?`; params.push(filters.assigneeId); }
if (filters.dueBefore) { query += ` AND due_date <= ?`; params.push(filters.dueBefore); }
const rows = await this._db.all(query, params);
```

`validate_contract_drift.py`가 이 드리프트를 감지하지 못한 이유: 쿼리 파라미터 존재 여부는 검증하지만, 구현이 그 파라미터를 실제로 사용하는지는 정적 분석으로 추적하기 어렵다. 이것이 LESSON으로 기록되었다.

---

## 전(轉) — 구현 (기초 → 심화)

### Level 1: 기초 — TaskController 5경로 구조

```javascript
// domains/productivity/task-tracking/src/interface/TaskController.js
class TaskController {
  register(app) {
    app.post  ('/tasks',             this._authz('task:write'), this._createTask.bind(this));
    app.get   ('/tasks/:id',         this._authz('task:read'),  this._getTask.bind(this));
    app.get   ('/tasks',             this._authz('task:read'),  this._listTasks.bind(this));
    app.patch ('/tasks/:id/status',  this._authz('task:write'), this._transitionStatus.bind(this));
    app.patch ('/tasks/:id/assignee',this._authz('task:write'), this._reassignTask.bind(this));
  }

  _authz(requiredPermission) {
    return (req, res, next) => {
      const userPermissions = req.user?.permissions ?? [];
      if (!userPermissions.includes(requiredPermission)) {
        return res.status(403).json({ type: 'FORBIDDEN', title: 'Insufficient permissions' });
      }
      next();
    };
  }
}
```

`_authz()` 미들웨어가 Controller 레이어에서 권한을 선(先)검증. UseCase는 권한을 모른다.

### Level 2: 중급 — INV004 소급 반영 경위

```javascript
// capability.yaml INV004 누락(GAP-001)이 Stage E에서 발견됨
// DONE 작업의 담당자를 변경하려는 시도:
// Stage D 초기: reassign-task가 DONE 상태를 차단하지 않았다

// 수정 후 ReassignTaskUseCase:
async execute({ taskId, newAssigneeId }) {
  const task = await this._taskRepo.findById(taskId);
  if (task.status === 'DONE') {
    throw new DomainError('INV004', 'Cannot reassign DONE task');  // INV004
  }
  // ...
}
```

GAP-001은 P2 심각도였지만 즉시 수정(FIXED)했다. 감사 추적(audit trail) 신뢰성에 직접 영향을 미치기 때문 — DONE된 작업의 담당자가 사후에 변경되면 책임 추적이 불가능해진다.

### Level 3: 심화 — 23-test authz 회귀 행렬

```javascript
// domains/productivity/task-tracking/tests/interface/TaskController.authz.test.js
const SCENARIOS = [
  // [경로, 메서드, 권한, 기대상태]
  ['/tasks',           'POST',  'task:write', 201],
  ['/tasks/:id',       'GET',   'task:read',  200],
  ['/tasks',           'GET',   'task:read',  200],
  ['/tasks/:id/status','PATCH', 'task:write', 200],
  ['/tasks/:id/assignee','PATCH','task:write', 200],
  // 권한 없는 경우:
  ['/tasks',           'POST',  null,         403],
  ['/tasks/:id',       'GET',   null,         403],
  // 잘못된 권한:
  ['/tasks/:id/status','PATCH', 'task:read',  403],  // read로 write 시도
  // ...
];
```

올바른 권한 → 성공 응답, 없는 권한 → 403, 잘못된 권한 → 403 세 케이스를 모두 커버. **23개 테스트가 5개 경로의 권한 행렬을 완전히 포괄**한다.

---

## 결(結) — 결과와 교훈

### 게이트 결과
| 항목 | 결과 | 비고 |
|------|------|------|
| unit-tests | PASS | TaskController 포함 전체 |
| authz-regression | PASS | 23/23 PASS |
| e2e-smoke | PASS | TaskController smoke suite |
| contract-tests | PASS | drift validator PASS |
| lint | PASS | 0 errors |

### 이번 Stage에서 배운 것

1. **단순 도메인이 기준 사례가 된다**: task-tracking은 crud-entity + state_machine의 가장 단순한 조합. billing과 video가 이 패턴을 따랐기 때문에 파이프라인 자동화가 가능했다. 복잡한 도메인보다 단순하고 명확한 기준 사례가 시스템 전체의 품질을 높인다.

2. **계약에 있는 파라미터는 반드시 구현에도 있어야 한다**: `due_before` 드리프트는 계약 드리프트 검증기가 "파라미터 존재"를 체크해도 "파라미터 활용"을 체크하지 못하는 한계를 드러낸다. 구현체 커버리지 테스트가 보완책.

3. **Stage E → Stage D 피드백이 설계를 소급 개선한다**: INV004는 Stage A 계약에 없었지만 Stage E 적대적 검증에서 발견되어 capability.yaml에 소급 반영되었다. E는 D의 버그를 고치는 것뿐 아니라 A의 계약 누락도 발견한다.

### 다음 액션
전 도메인 570/570 테스트 유지 + 4번째 자가개선 라운드 (현재 진행 중).
