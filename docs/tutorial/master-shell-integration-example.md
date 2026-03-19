# 마스터 UI 통합 예제

> **학습용** 문서: 도메인 모듈이 마스터 UI 포털에 통합되는 예제

## 시나리오

주문 관리 모듈을 마스터 UI의 "상거래" 그룹에 등록한다.
사용자는 마스터 UI에서 "주문 관리" 메뉴를 클릭해 진입한다.

---

## 마스터 UI의 역할

마스터 UI는 **도메인 포털**이다. 기술 콘솔이 아니다.
사용자는 "주문 관리", "고객 조회" 같은 도메인 언어로 탐색한다.

## 1단계: UI Contract 확인

```yaml
# domains/commerce/ordering/contract/ui-contract.yaml
entry_points:
  - route: "/orders"
    label: "주문 관리"
    description: "주문 생성, 조회, 상태 변경"
```

## 2단계: Plugin Registry 등록

```yaml
# master-shell/plugin-registry/registry.yaml
plugins:
  - id: "ordering-plugin"
    name: "주문 관리"          # 도메인 언어
    module_id: "ordering"
    entry_point: "/orders"
    navigation:
      group: "commerce"
      label: "주문 관리"       # 도메인 언어
      icon: "shopping-cart"
      order: 1
    ui_contract: "domains/commerce/ordering/contract/ui-contract.yaml"
    capability_contract: "domains/commerce/ordering/contract/capability.yaml"
    feature_flag: "enable_ordering_module"
    status: "active"
```

## 3단계: Feature Flag로 안전하게 활성화

```yaml
# requirements/requirements.yaml
feature_flags:
  enable_ordering_module: false  # 처음에는 false
```

Stage D PASS 후 단계적으로 활성화한다.

## 마스터 UI가 읽는 순서

1. root `memory/current-state.yaml` 읽기
2. 필요 시 `memory/project/current-state.yaml`로 레거시 상세 보완
3. `master-shell/plugin-registry/registry.yaml` 읽기
4. 각 플러그인의 `ui_contract` 읽기
5. 각 플러그인의 `capability_contract` 읽기
6. Feature flag 확인 후 UI 렌더링

**마스터 UI는 모듈 코드를 직접 읽지 않는다.**

## 배운 점

- Plugin Registry는 계약 경로만 참조한다 (코드 경로 금지).
- Feature Flag는 기본값 false로 시작한다.
- 마스터 UI는 도메인 포털이며 기술 용어를 노출하지 않는다.
