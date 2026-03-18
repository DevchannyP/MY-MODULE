# 모듈 퀴즈 템플릿

> **학습용** 문서: 모듈 개념 이해도를 확인하는 퀴즈

## 퀴즈: [모듈 이름]

**연관 예제**: worked-example-template.md

---

### Q1. Bounded Context

다음 중 올바른 설명은?

a) 모듈은 다른 모듈의 코드를 직접 import할 수 있다.
b) 모듈 간 통신은 계약 참조만 허용한다.
c) 도메인 코어는 데이터베이스 스키마를 알아야 한다.
d) UI 컴포넌트가 도메인 로직을 포함할 수 있다.

**정답**: b)
**해설**: constraints.yaml C001 참조. 계약 참조만 허용한다.

---

### Q2. Public Contract

이 모듈은 몇 가지 유형의 계약을 가져야 하는가?

**정답**: 4가지 (HTTP/OpenAPI, 이벤트/AsyncAPI, UI Contract, Capability)
**해설**: 최소 1개 이상 필수. 4가지 모두 작성 권장.

---

### Q3. Stage 판단

capability.yaml에 새로운 permission이 추가되었다. 어떤 Stage를 실행해야 하는가?

**정답**: Stage A 재실행
**해설**: 권한 변경은 Stage A 트리거. routing-rules.md 참조.

---

### 실습 문제

`requirements.yaml`의 `module.domain`을 변경했을 때:
1. 어떤 Stage를 재실행해야 하는가?
2. 어떤 memory 파일을 갱신해야 하는가?
3. 어떤 ADR을 작성해야 하는가?

[정답은 docs/how-to/run-stage-a.md와 docs/adr/ 참조]
