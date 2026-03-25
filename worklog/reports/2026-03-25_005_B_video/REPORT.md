# 학습 보고서: Stage B — video

> 일자: 2026-03-25 | 순번: #005 | 작성: AI Agent (reporter)
> Stage: B | 도메인: video
> 게이트 결과: PASS | 조합 충돌: 0건

---

## 기(起) — 배경과 문제 정의

video 도메인은 task-management, billing과 직접 의존 관계가 없는 **완전 독립 Bounded Context**다. Stage B의 목적은 이 독립성을 증명하고, 향후 의존성이 생길 경우의 연결 방식을 계약 레벨에서 확정하는 것이다.

핵심 도전: video 도메인은 8개 이벤트를 발행한다. 이 이벤트명이 기존 `Invoice*`, `Task*` 이벤트명과 충돌하지 않는다는 것을 Stage B에서 명시적으로 검증해야 한다.

### 핵심 용어
| 용어 | 한글 | 의미 |
|------|------|------|
| bounded context | 경계 컨텍스트 | 독립적 언어·모델·팀이 적용되는 도메인 영역 |
| event namespace | 이벤트 네임스페이스 | 이벤트명 앞에 붙는 도메인 식별자 패턴 |
| 독립 롤아웃 | independent rollout | 다른 도메인에 영향 없이 단독으로 배포 가능한 속성 |

---

## 승(承) — 설계 결정

### 외부 의존성 없음 — 결정 근거

```yaml
# memory/stageB/video.yaml
dependency_analysis:
  depends_on: []
  depended_by: []
  notes: |
    video 도메인은 task-management, billing과 직접 의존 관계가 없다.
    향후 billing 연동(유료 영상 과금)이 발생할 경우
    이벤트 기반 느슨한 결합을 사용한다.
```

향후 "유료 영상 과금" 기능이 추가되더라도, billing 도메인이 `VideoReady` 이벤트를 구독해서 인보이스를 생성하는 방식으로 구현한다. video 도메인이 billing을 직접 호출하지 않는다.

### 이벤트 네임스페이스 격리 확인

| 이벤트명 | 접두사 | 충돌 여부 |
|---------|------|---------|
| VideoUploaded | Video* | 충돌 없음 |
| VideoProcessingStarted | Video* | 충돌 없음 |
| VideoReady | Video* | 충돌 없음 |
| VideoAccessPolicyChanged | Video* | 충돌 없음 |
| VideoArchived | Video* | 충돌 없음 |
| TranscodeJobStarted | TranscodeJob* | 충돌 없음 |
| TranscodeJobCompleted | TranscodeJob* | 충돌 없음 |
| TranscodeJobFailed | TranscodeJob* | 충돌 없음 |

---

## 전(轉) — 계약 스니펫 (기초 → 심화)

### Level 1: 기초 — 경로 분리 검증

```
task-management: /tasks/*
billing:         /billing/*
video:           /videos/*
                 ↑ 완전 다른 URL 접두사. 충돌 불가능.
```

단순하지만 확실한 격리. `/video` (단수)가 아닌 `/videos` (복수)를 선택한 이유: REST 복수명사 관습 + `/video`는 향후 `video-settings` 등 다른 도메인이 사용할 수 있는 접두사이기 때문.

### Level 2: 중급 — 권한 네임스페이스 독립성

```
task-management: task:read, task:write
billing:         billing.read, billing.write, billing.admin
video:           video:read, video:write, video:admin
```

`video:admin`과 `billing.admin`은 완전히 다른 권한. 교차 적용 불가. video admin이 billing 데이터에 접근하려면 `billing.*` 권한이 별도로 있어야 한다 — 이것이 도메인 격리의 본질.

### Level 3: 심화 — 미래 의존성 설계 원칙

```yaml
# 향후 유료 영상 과금이 필요할 때의 올바른 연결 방식:

# billing 도메인의 Stage B memory에 추가될 항목 (현재는 없음):
# depends_on_contracts:
#   - path: "domains/video/contract/events.schema.json"
#     capability_ids: ["VideoReady", "VideoArchived"]
#     type: "event"
#     purpose: "영상 완성 시 자동 과금 트리거"
#
# video 도메인의 계약은 변경 없음 — billing이 one-way dependency를 선언
```

video가 billing을 모른 채로 billing이 video 이벤트를 구독한다. Clean Architecture의 "의존성 역전" 원칙이 도메인 계층에서 적용된 것.

---

## 결(結) — 결과와 교훈

### 게이트 결과
| 항목 | 결과 | 비고 |
|------|------|------|
| 경로 충돌 | PASS | `/videos/*` 고유 |
| 이벤트 충돌 | PASS | 8개 이벤트 모두 고유 |
| 권한 충돌 | PASS | `video:*` 네임스페이스 고유 |
| 외부 의존성 | PASS | depends_on: [] 확인 |
| central registry | 이후 수정 | LESSON-006: Stage E 완료 후 8개 이벤트 등록 |

### 이번 Stage에서 배운 것

1. **완전 독립 도메인은 Stage B가 빠르다**: 충돌 검사가 "0건"으로 끝난다. 오히려 **향후 의존성이 생길 경우의 설계 패턴**을 명시하는 것이 Stage B의 진짜 가치다.

2. **이벤트 네임스페이스 + 8개 이벤트 → 중앙 레지스트리 필수**: 이벤트가 많을수록 중앙 레지스트리 없이는 어떤 도메인이 어떤 이벤트를 구독할 수 있는지 파악하기 어렵다. LESSON-006은 이 교훈에서 비롯됐다.

3. **Stage B "충돌 없음"도 문서화해야 한다**: "아무 문제 없었다"는 것이 Stage B 결과다. 이것을 기록하지 않으면 나중에 "Stage B를 했는가?"를 증명할 수 없다. 부재 증명도 증거다.

### 다음 액션
Stage C: master-shell에 video-plugin 등록 + feature-flags 활성화 + central event registry에 8개 이벤트 등록.
