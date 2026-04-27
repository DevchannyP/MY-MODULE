# 학습 보고서: Stage A — video

> 일자: 2026-03-25 | 순번: #002 | 작성: AI Agent (reporter)
> Stage: A | 도메인: video
> 게이트 결과: PASS | 테스트: N/A (Stage A는 설계 단계)

---

## 기(起) — 배경과 문제 정의

현대 플랫폼에서 미디어 자산(media asset)은 단순한 파일 저장 이상의 생명주기(lifecycle)를 가진다. 사용자가 영상을 업로드하면, 원본 파일은 즉시 재생 가능한 상태가 아니다. MP4·HLS·DASH 같은 다양한 포맷과 해상도(720p, 1080p 등)로 변환하는 트랜스코딩(transcoding) 파이프라인을 거쳐야 비로소 시청자에게 전달될 수 있다.

이 과정에서 세 가지 핵심 문제가 발생한다.

**첫째, 상태 불일치 위험.** 트랜스코딩은 수 분에서 수십 분까지 걸리는 비동기(asynchronous) 작업이다. `UPLOADING` 상태, 변환 중인 `PROCESSING` 상태, 재생 가능한 `READY` 상태, 더 이상 활성화되지 않는 `ARCHIVED` 상태를 명확히 구분하지 않으면 미완성 영상이 재생되거나 아카이브된 영상에 새 작업이 시작될 수 있다.

**둘째, 동시 작업 충돌.** 같은 영상에 대해 여러 트랜스코딩 작업이 동시에 실행되면 인프라 비용이 폭증하고 결과물이 서로 덮어씌워질 수 있다 (INV-V004).

**셋째, 접근 통제(access control) 복잡성.** 영상 소유자(uploader)는 자신의 PRIVATE 영상을 공개 전에 미리 볼 수 있어야 하지만, 다른 일반 사용자에게는 노출되어서는 안 된다. 관리자(admin)는 모든 영상에 접근할 수 있어야 한다 (INV-V003).

### 핵심 용어
| 용어 | 한글 | 의미 |
|------|------|------|
| transcoding | 트랜스코딩 | 원본 영상을 다른 포맷·해상도로 변환하는 작업 |
| rendition | 렌디션 | 트랜스코딩 결과로 생성된 변환본 (예: 1080p MP4) |
| state machine | 상태 기계 | 허용된 상태와 전이(transition)를 정의한 모델 |
| access policy | 접근 정책 | 영상을 누가 볼 수 있는지 결정하는 규칙 (PUBLIC / PRIVATE / INTERNAL) |
| invariant | 불변조건 | 시스템이 항상 만족시켜야 하는 규칙 |
| EventEnvelope | 이벤트 봉투 | 도메인 이벤트를 감싸는 표준 메타데이터 구조 |

---

## 승(承) — 설계 결정

### capability.yaml — 7개 역량 + 8개 이벤트

| capability id | 설명 | 필요 권한 |
|---|---|---|
| `can.upload.video` | 영상 업로드 | `video:write` |
| `can.read.video` | 목록 및 상세 조회 | `video:read` |
| `can.start.transcode` | 트랜스코딩 시작 | `video:write` |
| `can.read.transcode.status` | Job 상태 조회 | `video:read` |
| `can.change.access.policy` | 접근정책 변경 | `video:write` |
| `can.archive.video` | 영상 아카이브 | `video:admin` |
| `can.mount.video` | 마스터 UI 마운트 | `video:read` |

아카이브는 `video:admin`만 수행할 수 있도록 설계하여 일반 사용자의 실수를 방지했다.

### 불변조건(Invariant) 설계: INV-V001 ~ INV-V005

| ID | 핵심 내용 | 수호 capability |
|---|---|---|
| INV-V001 | `title`, `uploader_id`, `original_file_ref` 필수 | `can.upload.video` |
| INV-V002 | 상태 단방향 전이만 허용, `ARCHIVED`는 터미널 상태 | 여러 capability |
| INV-V003 | PRIVATE 영상은 업로더 본인 또는 admin만 접근 | `can.read.video` 외 |
| INV-V004 | 동시에 하나의 RUNNING TranscodeJob만 허용 | `can.start.transcode` |
| INV-V005 | COMPLETED Job은 반드시 `output_rendition_ref` 보유 | TranscodeJob 스키마 |

INV-V002와 INV-V003은 복수의 capability에 걸쳐 적용되는 교차 불변조건(cross-cutting invariant)이다.

### 비동기 트랜스코딩 설계

트랜스코딩은 동기(synchronous) HTTP 응답으로 완료를 반환할 수 없다. `startTranscodeJob` API는 `201 Created`로 Job 생성만 확인하고, 실제 완료/실패는 도메인 이벤트로 전파한다.

```yaml
# RISK-V002: 트랜스코딩은 비동기 — UseCase는 Job ID만 반환한다.
# StartTranscodeJobUseCase.execute() → { job_id: "uuid" }  (즉시)
# 수 분 후 → TranscodeJobCompleted 이벤트 발행 → VideoReady 이벤트 연쇄
```

### 이벤트 스키마 — EventEnvelope 분리

```json
// EventEnvelope는 모든 이벤트가 공유하는 래퍼
"EventEnvelope": {
  "required": ["event_id", "event_type", "domain", "occurred_at", "correlation_id", "payload"],
  "properties": {
    "domain": { "type": "string", "const": "video" }
  }
}
```

`domain: "video"` 필드를 `const`로 고정한 점이 중요하다. 이벤트 버스 환경에서 video 이벤트만 필터링할 때 이 상수가 기준이 된다. `validate_contract_drift.py`의 `video_event_ids()`는 `EventEnvelope`를 제외하고 실제 이벤트 8개만 커버리지 검사 대상으로 집계한다.

---

## 전(轉) — 핵심 계약 스니펫 (기초 → 심화)

### Level 1: 기초 — INV-V004와 409 Conflict 응답의 계약 연결

```yaml
# domains/video/contract/openapi.yaml
/videos/{videoId}/transcode:
  post:
    description: >
      트랜스코딩 작업을 시작한다.
      동시에 하나의 RUNNING Job만 허용된다 (INV-V004).
    responses:
      "201": { description: "트랜스코딩 작업 시작 성공" }
      "409": { $ref: "#/components/responses/Conflict" }
      # 400 Bad Request가 아닌 409 Conflict — 입력 오류가 아닌 리소스 상태 충돌
```

`400`이 아닌 `409`를 쓴 이유: 요청이 잘못된 게 아니라 지금 시도할 수 없는 상태(RUNNING Job 존재)임을 클라이언트에 명확히 전달한다.

### Level 2: 중급 — Video 상태 기계

```
UPLOADING ──→ PROCESSING ──→ READY ──→ ARCHIVED
                              ↓
                         VideoReady 이벤트 발행
                         (TranscodeJobCompleted 수신 시)

금지된 전이:
  ARCHIVED → *  (터미널 상태 — INV-V002)
  PROCESSING → ARCHIVED  (완료 전 아카이브 불가)
```

### Level 3: 심화 — 접근 정책의 직교 설계와 Stage D 구현 패턴

```javascript
// 두 관심사(상태 + 접근정책)가 독립적으로 변경된다
// Video.state: UPLOADING | PROCESSING | READY | ARCHIVED
// Video.accessPolicy: PUBLIC | PRIVATE | RESTRICTED

// ChangeAccessPolicyUseCase는 state를 건드리지 않는다 (불변 패턴)
class Video {
  changeAccessPolicy(newPolicy) {
    if (this.state === 'ARCHIVED') {
      throw new DomainError('INV-V002: cannot change policy on ARCHIVED video');
    }
    return new Video({ ...this, accessPolicy: newPolicy }); // 새 인스턴스
  }
}
```

---

## 결(結) — 학습된 것

1. **비동기 UseCase는 "결과 없음"을 계약에 명시**: `can.start.transcode`의 응답이 `job_id`만인 것을 capability.yaml에 명시하면, 프론트엔드가 폴링/웹소켓을 설계할 때 혼선이 없다.

2. **이벤트 8개를 중앙 레지스트리에 등록 필수**: video 도메인은 Stage A~E 완성 후에도 `contracts/events/registry.yaml`에 등록되지 않아 중앙 레지스트리 사각지대가 발생했다 (LESSON-006). 온보딩 체크리스트에 필수 항목.

3. **`video_event_ids()`는 EventEnvelope를 반드시 제외**: 이벤트 스키마의 `definitions`에 공유 타입(`EventEnvelope`)이 섞여 있을 때, 커버리지 검사 함수는 실제 이벤트만 집계해야 한다.

4. **단일 RUNNING Job 제한(INV-V004)은 낙관적 동시성 제어의 씨앗**: 계약 단계에서 명시했기 때문에 Stage D 구현자가 트랜잭션 경계를 어디에 두어야 할지 판단할 수 있다.

**다음 단계**: Stage D에서 INV-V002(상태 전이), INV-V003(접근 제어), INV-V004(동시 작업)를 적대적 벡터로 검증.
