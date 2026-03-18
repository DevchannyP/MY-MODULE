# Workflow OS 개념 설명

> **WHY** 중심 문서: 이 시스템을 왜 이렇게 설계했는가?

## 이 시스템이 해결하는 문제

소프트웨어 프로젝트가 성장할수록 다음 문제가 반복된다:

1. **결합 폭발**: 모듈이 서로 코드를 직접 참조하면서 변경이 전파되고 테스트가 불가능해진다.
2. **도메인 침식**: UI/DB/프레임워크 관심사가 비즈니스 로직을 잠식한다.
3. **반복 불가능한 구조**: "이렇게 하면 된다"는 암묵적 지식이 사라지면 처음부터 시작해야 한다.
4. **품질 게이트 없는 완료 선언**: 검증 없이 완료라고 선언하면 기술 부채가 누적된다.

## Workflow OS가 제시하는 해결 방식

Workflow OS는 저장소 자체를 "운영체제"처럼 설계한다.
운영체제가 프로세스를 격리하고 인터페이스로 통신시키듯,
이 저장소는 도메인 모듈을 격리하고 계약으로만 통신시킨다.

### 핵심 비유

| 운영체제 | Workflow OS |
|---|---|
| 프로세스 격리 | 모듈 격리 (Bounded Context) |
| 시스템 콜 인터페이스 | Public Contract (OpenAPI / AsyncAPI / UI Contract) |
| 커널 | Domain Core (UI/DB 모름) |
| 프로세스 간 통신 | 계약 참조 (코드 직접 참조 금지) |
| 운영체제 설치 | requirements.yaml 교체 후 Stage 실행 |

## 5단계 Stage 구조

```
requirements.yaml 교체
        ↓
   [Stage A] 격리 모듈 생성
   - bounded context 확정
   - 용어/권한/불변조건 정의
   - public contract 생성
        ↓
   [Stage B] 계약 기반 도메인 조합
   - domain-map 기반 화면 구성
   - shared libs / composition policy
        ↓
   [Stage C] 마스터 UI 편입
   - plugin registry 등록
   - navigation / feature flag / rollout
        ↓
   [Stage D] 품질/보안/공급망/관측성 게이트 판정
   - FAIL이면 완료 선언 불가
   - 수정 후 재판정
        ↓
   [Stage E] 적대적 검증 및 자기개선
   - 반복 실패 / 수동 개입 증가 시
   - 구조 단순화 제안
```

## 마스터 UI: 기술 콘솔이 아닌 도메인 포털

마스터 UI는 **기술적 관리 화면이 아니다.**
사용자가 도메인 작업을 수행하는 포털이며, 플러그인 쉘 구조로 각 도메인 모듈을 탑재한다.

- **도메인 포털**: 사용자는 "주문 관리", "고객 조회" 등 도메인 언어로 탐색한다.
- **플러그인 쉘**: 각 도메인 모듈은 plugin-registry에 등록되어 마스터 UI에 탑재된다.
- **계약 기반 탑재**: 마스터 UI는 모듈 코드를 모른다. ui-contract.yaml만 읽는다.

## 재실행 가능성: 운영체제의 핵심 가치

이 시스템의 가장 중요한 속성은 **반복 가능성**이다.
requirements/requirements.yaml 하나만 교체하면:
- 새 모듈을 격리 생성할 수 있다.
- 기존 모듈을 재검증할 수 있다.
- 도메인 조합을 재구성할 수 있다.
- 품질 게이트를 다시 돌릴 수 있다.

이 속성을 유지하기 위해 memory/, worklog/, docs/adr/ 구조가 필수다.
