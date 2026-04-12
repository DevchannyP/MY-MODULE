# Workflow OS — 연속 실행 마스터 프롬프트

> 이 파일을 매 세션 시작 시 아래 프롬프트를 그대로 입력하면 Claude가 현재 상태를 파악하고
> 다음 작업을 자동으로 이어 실행합니다.

---

## 세션 시작 프롬프트 (복사해서 사용)

```
계속
```

> 단어 하나만으로 충분합니다.  
> Claude는 CLAUDE.md 규칙에 따라 아래 세션 초기화 프로토콜을 자동 실행합니다.

---

## 작업 지시 프롬프트 패턴

### 새 기능 / 도메인 추가
```
A [도메인명]
```
예: `A payment-refund`

### 구현만 (설계 완료 후)
```
D [도메인명]
```

### 전체 검증 + 리뷰
```
E [도메인명]
```

### 품질 게이트 전체 실행
```
게이트
```

### 현재 상태 보고
```
검토
```

### 특정 버그/요청 → 하네스가 자동 재구성
```
[자유 형식 요청]

예:
- "파일첨부 삭제 버그 수정해줘"
- "billing 도메인에 환불 기능 추가"
- "Master UI 칸반 보드 안 보여"
```
Claude는 이를 아래 구조로 **자동 재구성**한 후 실행합니다:
- 목표 / 맥락 / 제약 / 완료조건 / 작업방식 / 검증

---

## 세션 초기화 프로토콜 (Claude 내부 동작)

Claude가 `계속` 또는 임의 프롬프트를 받으면:

### Step 1 — 상태 파악 (필수 읽기 순서)
1. `memory/L0-hot/current-state.yaml` — 현재 Stage/도메인 상태
2. `memory/L0-hot/next-actions.yaml` — 다음 우선순위 작업
3. `memory/L0-hot/reflection-log.yaml` — 이전 실패 교훈
4. `memory/wp-queue.yaml` — Work Packet DAG 상태
5. `memory/current-wp.yaml` — 현재 활성 패킷
6. `requirements/harness-engineering.yaml` — 하네스 규칙

### Step 2 — 요청 재구성 (Intake Packet)
모든 요청을 6개 필드로 재구성:
```yaml
goal:        "무엇을 달성해야 하는가"
context:     ["관련 파일/함수/데이터 구조"]
constraints: ["건드리면 안 되는 영역"]
done_when:   ["사용자 관점 완료조건"]
work_mode:   ["원인 분석 → 변경 포인트 → 구현 → 테스트"]
verification: ["변경 후 반드시 확인할 관찰 지점"]
```

### Step 3 — 실행 라우팅
| 요청 유형 | 루트 |
|-----------|------|
| 신규 도메인/기능 | Stage A → B → C → D → E |
| 버그 수정 | 원인 분석 → 최소 변경 → 회귀 테스트 |
| 계약/구조 변경 | Stage A부터 재실행 |
| UI/내비게이션 변경 | Stage B부터 재실행 |
| 설정/인프라 변경 | Stage C부터 재실행 |
| 불확실 | Stage A부터 |

### Step 4 — 검증 루프 (완료 선언 전 필수)
```
validation_profile에 따라 자동 선택:
- npm run lint
- npm test
- npm run test:contract
- npm run test:e2e-smoke
- npm run validate:composition
```

### Step 5 — 보고 형식
```
## 실행 결과
실행한 것: [Stage + 도메인 + 핵심 행동]
게이트 결과: PASS / FAIL
테스트: [N/N PASS]
남은 리스크: [있으면 명시]
다음: [다음 work packet]
차단: 없음 / [이유]
```

---

## 하네스 설계 원칙 요약

### 5대 구조 원칙
| # | 원칙 | 구현 |
|---|------|------|
| 1 | 목표·맥락·제약·완료조건 구조화 | intake_packet 자동 재구성 |
| 2 | 계획 먼저, 코딩 나중 | Stage A/B → Stage D 순서 강제 |
| 3 | 규칙은 파일에 고정 | CLAUDE.md + requirements/*.yaml |
| 4 | 작게 나눠 점진적 실행 | Work Packet DAG |
| 5 | 항상 검증 루프 | validation_profile 자동 실행 |

### 아키텍처 원칙
- **결합도 최저**: Port/Adapter 경계만 허용
- **응집도 최고**: 기능적 응집(Functional Cohesion) 목표
- **정보 은닉**: contracts/만 공개 경계
- **불변성**: 엔티티 직접 수정 금지, 새 인스턴스 반환
- **패턴 적용**: Singleton(전역 코디네이터) + Builder(복잡 객체) + Factory Method(어댑터 생성) + Template Method(고정 생명주기)

### 형상관리 원칙
- 작업 유형별 브랜치: `feat/`, `fix/`, `chore/`, `test/`, `docs/`
- Conventional Commit 강제: `type(scope): subject`
- 커밋 게이트: 검증 통과 후에만 커밋 후보

### 테스트 계층
```
단위 → 통합 → 회귀 → 화이트박스 → 시스템
  ↕       ↕       ↕        ↕          ↕
도메인  저장소  결함방지   분기커버리지  전체통합
```

---

## 자주 쓰는 명령어

```bash
# 현재 상태 확인
npm run project:status
npm run wp:next

# 다음 WP 실행
npm run session:bootstrap

# 브랜치 생성
npm run branch:bootstrap

# 커밋 가드
npm run commit:guard

# 전체 품질 게이트
npm test && npm run lint && npm run test:contract && npm run test:e2e-smoke

# Master UI 재생성
npm run ui:build

# 칸반 보드 업데이트
node scripts/generate-ui-home.js
```

---

## 연속 실행 보장 메커니즘

매 세션에서 Claude는 다음을 확인합니다:

1. **현재 위치**: 어떤 WP가 진행 중인가?
2. **차단 여부**: 실패 패턴이 3회 반복됐는가?
3. **다음 행동**: next-actions.yaml priority 1은 무엇인가?
4. **리스크 확인**: failure-patterns.yaml에 새 패턴이 있는가?

이 4가지를 확인한 후 자동으로 가장 우선순위 높은 작업을 이어 실행합니다.

---

*이 파일은 `docs/harness/CONTINUOUS_PROMPT.md`에 위치합니다.*  
*변경 시 `requirements/harness-engineering.yaml`과 동기화하세요.*
