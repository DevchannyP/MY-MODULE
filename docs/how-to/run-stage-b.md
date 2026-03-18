# Stage B 실행 방법

> **HOW** 중심 문서: 계약 기반 도메인 조합 단계를 어떻게 실행하는가?

## 사전 조건

- Stage A가 PASS 상태여야 한다.
- `memory/stageA/[module-id].yaml`이 존재해야 한다.
- `requirements/domain-map.yaml`이 최신 상태여야 한다.

## 실행 절차

### 1단계: Stage A Memory 읽기

```
memory/stageA/[module-id].yaml 읽기
→ bounded_context, contracts 경로 확인
→ invariants, permissions 재확인
```

### 2단계: Domain Map 기반 조합 계획

`requirements/domain-map.yaml`을 읽고:
1. 이 모듈이 의존하는 다른 모듈의 capability.yaml 경로를 확인한다.
2. `requirements.yaml`의 `composition.depends_on`에 계약 참조를 추가한다.
3. 코드 직접 참조가 없는지 확인한다.

### 3단계: 화면 구성 정의

`contract/ui-contract.yaml`의 screens 섹션을 채운다:
- 각 화면이 어떤 capability를 필요로 하는지 명시
- 화면 간 이동 흐름 정의 (도메인 언어로)

### 4단계: Shared Libs 검토

공유 라이브러리가 필요한 경우:
1. ADR로 정당화한다.
2. 공유 라이브러리는 도메인 코어에 의존성을 갖지 않아야 한다.
3. `requirements/domain-map.yaml`의 `shared_kernel` 섹션에 등록한다.

### 5단계: Memory 저장

`memory/stageB/[module-id]-composition.yaml`을 생성한다.

### 6단계: 품질 게이트 확인

Stage B 완료 기준:
- [ ] 모든 depends_on이 계약 참조(코드 참조 없음)
- [ ] ui-contract.yaml의 screens 섹션 완성
- [ ] 공유 라이브러리 사용 시 ADR 존재
- [ ] memory/stageB/ 파일 저장 완료
