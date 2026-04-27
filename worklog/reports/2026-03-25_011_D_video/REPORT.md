# 학습 보고서: Stage D — video

> 일자: 2026-03-25 | 순번: #011 | 작성: AI Agent (reporter)
> Stage: D | 도메인: video
> 게이트 결과: PASS | 테스트: VideoController 7경로 authz PASS, 자가개선 5라운드

---

## 기(起) — 배경과 문제 정의

video 도메인의 Stage D는 두 가지 구조적 복잡성이 교차하는 지점이다.

**첫째, 비동기 트랜스코딩 파이프라인**: HTTP 응답 시간 내에 완료되지 않는 작업을 구현해야 한다. `StartTranscodeJobUseCase`는 Job ID만 즉시 반환하고, 실제 완료/실패는 이벤트로 전파된다.

**둘째, 다차원 접근 제어(Multi-dimensional Access Control)**: Video 상태(UPLOADING/PROCESSING/READY/ARCHIVED)와 접근 정책(PUBLIC/PRIVATE/RESTRICTED)이 독립적으로 변경되면서도 INV-V003(PRIVATE 영상은 업로더·admin 전용)을 항상 만족해야 한다.

Stage E 자가개선 5라운드에서 발견된 3개 갭(GAP-V001~V003)이 Stage D 구현의 취약점을 드러냈다 — ListVideosUseCase가 PRIVATE 영상을 비소유자에게 노출하는 버그가 포함되어 있었다.

### 핵심 용어
| 용어 | 한글 | 의미 |
|------|------|------|
| TranscodeJob | 트랜스코딩 작업 | 영상 변환 작업 단위. PENDING→RUNNING→COMPLETED/FAILED |
| INV-V002 | 상태 단방향 | UPLOADING→PROCESSING→READY→ARCHIVED. 역전이 금지 |
| INV-V003 | 접근 통제 | PRIVATE는 업로더 본인 + admin만 접근 |
| INV-V004 | 동시 실행 제한 | 동일 Video에 RUNNING Job은 최대 1개 |
| rendition | 렌디션 | 트랜스코딩 결과로 생성된 변환본 |

---

## 승(承) — 설계 결정

### 비동기 UseCase 계약 — Job ID만 반환

```javascript
// RISK-V002: 트랜스코딩은 비동기 — UseCase는 Job ID만 즉시 반환
class StartTranscodeJobUseCase {
  async execute({ videoId, requestedBy, options }) {
    const video = await this._videoRepo.findById(videoId);

    // INV-V002: ARCHIVED 영상은 트랜스코딩 불가 (자가개선 5라운드 추가)
    if (video.state === 'ARCHIVED') {
      throw new DomainError('INV-V002', 'Cannot transcode ARCHIVED video');
    }

    // INV-V004: RUNNING Job이 이미 있으면 409
    const runningJob = await this._jobRepo.findRunningByVideoId(videoId);
    if (runningJob) {
      throw new AppError('CONFLICT', 'A transcoding job is already running for this video');
    }

    const job = TranscodeJob.create({ videoId, requestedBy, options });
    await this._jobRepo.save(job);
    return { jobId: job.id };  // ← 즉시 반환. 완료는 이벤트로 전파
  }
}
```

### GAP 수정 — ListVideosUseCase PRIVATE 영상 필터링

```javascript
// GAP-V001 수정 후:
class ListVideosUseCase {
  async execute({ requesterId, requesterRole, filters }) {
    const videos = await this._videoRepo.findByFilters(filters);

    // INV-V003: PRIVATE 영상은 업로더 본인 + admin만 조회 가능
    return videos.filter(video => {
      if (video.accessPolicy !== 'PRIVATE') return true;
      return video.uploaderId === requesterId || requesterRole === 'admin';
    });
  }
}
```

이 버그가 Stage D 초기 구현에 있었다는 점이 중요하다. UseCase 레이어가 권한 필터링을 책임져야 한다는 패턴이 명시되어 있었음에도 List 쿼리에서는 누락되었다.

---

## 전(轉) — 구현 (기초 → 심화)

### Level 1: 기초 — VideoController 7경로 authn/authz 매핑

```javascript
// domains/video/tests/interface/VideoController.authz.test.js 패턴
const ROUTE_AUTH_MATRIX = [
  { method: 'POST',   path: '/videos',                      role: 'video:write', status: 201 },
  { method: 'GET',    path: '/videos/:id',                  role: 'video:read',  status: 200 },
  { method: 'POST',   path: '/videos/:id/transcode',        role: 'video:write', status: 201 },
  { method: 'GET',    path: '/videos/:id/transcode/:jobId', role: 'video:read',  status: 200 },
  { method: 'PATCH',  path: '/videos/:id/access-policy',    role: 'video:write', status: 200 },
  { method: 'POST',   path: '/videos/:id/archive',          role: 'video:admin', status: 200 },
  { method: 'GET',    path: '/videos',                      role: 'video:read',  status: 200 },
];
```

7개 경로 × 다중 역할 시나리오로 authz 회귀를 완전 커버.

### Level 2: 중급 — 비동기 이벤트 체인

```
HTTP POST /videos/:id/transcode
  → StartTranscodeJobUseCase.execute()
    → return { jobId }  (201 즉시 응답)

[수 분 후, 비동기]
  → 외부 트랜스코딩 워커 완료
    → TranscodeJobCompleted 이벤트 발행
      → Video 상태 PROCESSING → READY 전이
        → VideoReady 이벤트 발행
          → 소비자 도메인(notification 등)이 구독
```

이 체인의 각 단계가 독립적으로 실패 가능하다. Stage E에서는 각 링크의 실패 시나리오를 적대적으로 검증했다.

### Level 3: 심화 — GetTranscodeJobUseCase PRIVATE 영상 접근 차단

```javascript
// GAP-V003 수정: Job 조회 시에도 부모 Video의 접근 정책 확인
class GetTranscodeJobUseCase {
  async execute({ jobId, requesterId, requesterRole }) {
    const job = await this._jobRepo.findById(jobId);
    const video = await this._videoRepo.findById(job.videoId);

    // Job을 조회할 때도 부모 Video의 접근 정책 확인 (GAP-V003)
    if (video.accessPolicy === 'PRIVATE'
        && video.uploaderId !== requesterId
        && requesterRole !== 'admin') {
      throw new AppError('FORBIDDEN', 'Cannot access transcoding job for PRIVATE video');
    }

    return job;
  }
}
```

접근 제어는 "읽기" 경로 전체에 적용해야 한다. 영상 조회만 막고 Job 조회를 허용하면, Job 메타데이터(rendition URL, 파일 크기 등)를 통해 PRIVATE 영상 정보가 간접 노출된다.

---

## 결(結) — 결과와 교훈

### 게이트 결과
| 항목 | 결과 | 비고 |
|------|------|------|
| unit-tests | PASS | 자가개선 5라운드 후 전체 PASS |
| authz-regression | PASS | VideoController 7경로 |
| e2e-smoke | PASS | VideoController smoke suite |
| contract-tests | PASS | drift validator PASS (8이벤트 커버리지) |
| event-registry | PASS | 8개 이벤트 central registry 등록 |

### 이번 Stage에서 배운 것

1. **PRIVATE 필터링은 "쿼리 전체"에 적용해야 한다**: List, Get, Job조회 등 모든 읽기 경로에 `accessPolicy === 'PRIVATE'` 검사가 있어야 한다. 하나라도 빠지면 간접 노출 경로가 생긴다 (Defense in Depth).

2. **비동기 UseCase는 Job ID만 반환한다는 계약이 프론트엔드 설계를 강제**: 계약에 `output: { job_id }` 만 명시하면 프론트엔드가 "완료 이벤트를 기다려야 한다"는 것을 처음부터 안다. 폴링 vs 웹소켓 선택도 UseCase 계약이 암시하는 것.

3. **Stage E 자가개선 라운드가 Stage D의 숨겨진 버그를 드러낸다**: GAP-V001~V003은 Stage D 코드에 있었지만 Stage E 적대적 검증 전까지 발견되지 않았다. E→D 피드백 루프가 없으면 이 버그들이 운영에 배포될 뻔했다.

### 다음 액션
중앙 이벤트 레지스트리(LESSON-006): 새 도메인 완성 시 `contracts/events/registry.yaml`에 이벤트 등록 — 온보딩 체크리스트 필수 항목.
