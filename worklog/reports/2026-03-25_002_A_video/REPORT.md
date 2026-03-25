# 학습 보고서: Stage A — video

> 일자: 2026-03-25 | 순번: #002 | 작성: AI Agent (reporter)
> Stage: A | 도메인: video
> 게이트 결과: PASS | 테스트: N/A (Stage A는 설계 전용)

---

## 기(起) — 배경과 문제 정의

video 도메인은 미디어 자산의 전체 생명주기(업로드 → 트랜스코딩 → 재생 → 보관)를 관리한다. 단순 파일 업로드와 다른 점은 **비동기 처리 파이프라인**이 중심에 있다는 것이다.

**핵심 설계 도전 3가지:**

1. **비동기 트랜스코딩**: 영상 변환은 수 분~수 시간이 걸린다. UseCase는 즉시 반환(Job ID만)하고, 결과는 이벤트로 수신하는 패턴이 필수.
2. **동시 작업 제한**: 같은 Video에 TranscodeJob이 동시에 2개 이상 RUNNING 상태가 되면 리소스 낭비·결과 충돌이 발생한다 (INV-V004).
3. **접근 정책 분리**: PUBLIC/PRIVATE/RESTRICTED 접근 정책은 Video 상태 전이와 독립적으로 변경 가능해야 한다. 두 관심사를 하나의 상태 기계로 묶으면 조합 폭발이 생긴다.

**아키타입**: `state_machines.requires_approval: false`, `async_pipeline: true` → `workflow-domain-module` 아키타입.

### 핵심 용어
| 용어 | 한글 | 의미 |
|------|------|------|
| TranscodeJob | 트랜스코드 작업 | 비동기 변환 작업. PENDING→RUNNING→COMPLETED/FAILED |
| AccessPolicy | 접근 정책 | PUBLIC / PRIVATE / RESTRICTED. Video와 독립 변경 가능 |
| INV-V002 | 상태 전이 불변 | Video: UPLOADING→PROCESSING→READY→ARCHIVED 순방향만 허용 |
| INV-V004 | 동시 작업 제한 | Video당 RUNNING TranscodeJob은 최대 1개 |

---

## 승(承) — 설계 결정

### capability.yaml — 7개 역량 + 8개 이벤트

```yaml
# domains/video/contract/capability.yaml (핵심 발췌)
capabilities:
  - id: can.upload.video
    events_emitted: [VideoUploaded, VideoProcessingStarted]

  - id: can.start.transcode
    invariants: [INV-V004]   # 동시 RUNNING 1개 제한
    events_emitted: [TranscodeJobStarted, VideoReady, TranscodeJobCompleted, TranscodeJobFailed]

  - id: can.change.access.policy
    events_emitted: [VideoAccessPolicyChanged]  # Video 상태 전이와 독립

  - id: can.archive.video
    invariants: [INV-V002]   # READY 상태에서만 아카이브 가능
    events_emitted: [VideoArchived]
```

`can.change.access.policy`를 별도 capability로 분리한 이유: READY 상태 Video의 접근 정책만 바꿀 때 상태 전이 로직을 거치지 않아야 한다. 분리 없이 하면 `transitionVideoStatus`에 `access_policy` 파라미터가 추가되어 단일 책임 원칙 위반.

### 비동기 트랜스코딩 설계

```yaml
# can.start.transcode 역량의 핵심 설계
#
# RISK-V002: 트랜스코딩은 비동기 — UseCase는 Job ID만 반환한다.
# 결과는 TranscodeJobCompleted 또는 TranscodeJobFailed 이벤트로 수신.
#
# 이것이 Stage D 구현에서 의미하는 것:
# StartTranscodeJobUseCase.execute() → { job_id: "uuid" }  (즉시)
# (수 분 후) TranscodeJobCompleted 이벤트 발행 → VideoReady 이벤트 연쇄
```

### 이벤트 스키마 — EventEnvelope 분리

```json
// domains/video/contract/events.schema.json
// EventEnvelope는 모든 이벤트가 공유하는 래퍼
"EventEnvelope": {
  "required": ["id", "type", "timestamp", "aggregate_id"],
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "type": { "type": "string" },
    "timestamp": { "type": "string", "format": "date-time" }
  }
}
// validate_contract_drift.py의 video_event_ids()는 EventEnvelope를 제외하고
// 실제 이벤트 8개만 커버리지 검사 대상으로 집계한다.
```

---

## 전(轉) — 구현 패턴

### Level 1: Video 상태 기계

```
UPLOADING ──→ PROCESSING ──→ READY ──→ ARCHIVED
                              ↓
                         VideoReady 이벤트 발행
                         (TranscodeJobCompleted 수신 시)
```

INV-V002: 역방향 전이 불가. ARCHIVED Video는 다시 READY가 될 수 없다.

### Level 2: INV-V004 동시 작업 제한 구현 패턴

```javascript
// Stage D에서 StartTranscodeJobUseCase가 검사해야 할 불변
class StartTranscodeJobUseCase {
  async execute({ videoId }) {
    const runningJobs = await this.repo.findRunningJobsFor(videoId);
    if (runningJobs.length >= 1) {
      throw new DomainError('INV-V004: concurrent RUNNING job limit exceeded');
    }
    // Job 생성 및 이벤트 발행
  }
}
```

### Level 3: 접근 정책과 상태 기계의 직교 설계

```javascript
// 두 관심사가 독립적으로 변경된다
// Video.state: UPLOADING | PROCESSING | READY | ARCHIVED
// Video.accessPolicy: PUBLIC | PRIVATE | RESTRICTED

// ChangeAccessPolicyUseCase는 state를 건드리지 않는다
class Video {
  changeAccessPolicy(newPolicy) {
    return new Video({ ...this, accessPolicy: newPolicy }); // 불변 패턴
  }
}
```

---

## 결(結) — 학습된 것

1. **비동기 UseCase는 "결과 없음"을 계약에 명시**: `can.start.transcode`의 응답이 `job_id`만인 것을 capability.yaml에 적어두면, 프론트엔드가 폴링/웹소켓을 설계할 때 혼선이 없다.

2. **이벤트 8개를 중앙 레지스트리에 등록 필수**: video 도메인은 Stage A~E 완성 후에도 `contracts/events/registry.yaml`에 등록되지 않아 중앙 레지스트리 사각지대가 발생했다. 온보딩 체크리스트에 "이벤트 레지스트리 등록"을 항목으로 추가해야 한다 (LESSON-006).

3. **`video_event_ids()`는 EventEnvelope를 반드시 제외**: 이벤트 스키마의 `definitions`에 공유 타입(`EventEnvelope`)이 섞여 있을 때, 커버리지 검사 함수는 실제 이벤트만 집계해야 한다.

**다음 단계**: Stage D에서 INV-V002(상태 전이), INV-V004(동시 작업)를 적대적 벡터로 검증. 비동기 트랜스코딩 UseCase의 Job ID 반환 패턴 테스트.
