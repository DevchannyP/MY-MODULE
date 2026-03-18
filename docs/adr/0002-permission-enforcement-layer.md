# ADR 0002: 권한 강제(Permission Enforcement) 레이어 결정

**날짜**: 2026-03-17
**상태**: 수락됨 (Accepted)
**결정자**: productivity-team
**발견 경위**: Stage E 적대적 검증 갭-2 — `permissions_required`가 UseCase 레이어에서 강제되지 않음

## 맥락

`capability.yaml`의 각 capability는 `permissions_required` 필드를 정의한다.
예: `create-task: permissions_required: ["task:write"]`

그러나 Stage E 적대적 검증 결과, `CreateTaskUseCase.execute()`는 호출자의 권한을 검사하지 않고 실행된다. 즉, task:read 권한만 가진 사용자도 UseCase를 직접 호출하면 작업을 생성할 수 있다.

이는 구조적 보안 갭이다. 권한 강제를 어느 레이어에서 할 것인지 결정이 필요하다.

## 결정

권한 강제는 **interface 레이어(HTTP 컨트롤러/미들웨어)** 에서 수행한다.

- **UseCase 레이어**: 권한 검사 없음. 도메인 규칙(불변조건)만 강제한다.
- **interface 레이어 (미구현, 향후)**: JWT/세션에서 role을 추출하고, capability.yaml의 `permissions_required`와 대조하여 접근을 허용/거부한다.
- **도메인 서비스**: 도메인 규칙(INV001~INV004)만 알고, 인증/인가를 모른다 (C002 준수).

```
HTTP 요청
    ↓
[interface 레이어] ← 권한 강제 (role 검사, capability permissions_required 대조)
    ↓ (허용된 경우만)
[application UseCase] ← 도메인 규칙만 강제 (INV001~INV004)
    ↓
[domain entity/service]
```

## 결과

1. UseCase는 단순하게 유지된다 (권한 파라미터 불필요).
2. interface 레이어가 보안 경계(security boundary) 역할을 한다.
3. 테스트 시 UseCase를 직접 호출하면 권한 검사 없이 실행됨을 인지해야 한다.
4. interface 레이어 구현 전까지 authn-authz 게이트는 NOT_CONFIGURED 상태를 유지한다.

## 대안

- **UseCase 레이어에서 권한 강제**: UseCase 생성자에 `callerRole` 파라미터 추가.
  → 거부: 도메인 로직에 인프라 관심사(인증)가 침투하여 C002 위반.
- **도메인 서비스에서 권한 강제**: 도메인 서비스가 권한을 알아야 함.
  → 거부: 도메인 코어가 보안 정책을 알게 됨. 순수성 파괴.

## 후속 작업

- `src/interface/TaskController.js` 구현 시 권한 미들웨어 추가
- `authn-authz-regression` 테스트 작성 (interface 레이어 완성 후)
- Stage D 재실행 시 해당 게이트 판정
