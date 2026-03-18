# Plugin Registry 스키마 참조

> **WHAT** 중심 문서: Plugin Registry 파일의 구조

## 파일 위치

`master-shell/plugin-registry/registry.yaml`

## 스키마

```yaml
version: "0.1.0"
plugins:
  - id: "plugin-id"
    name: "플러그인 이름 (도메인 언어)"
    module_id: "연결된 모듈 ID"
    entry_point: "/route/path"
    navigation:
      group: "navigation-group-id"
      label: "메뉴 레이블 (도메인 언어)"
      icon: "icon-name"
      order: 1
    ui_contract: "domains/xxx/contract/ui-contract.yaml"
    capability_contract: "domains/xxx/contract/capability.yaml"
    feature_flag: "enable_plugin_name"
    rollout:
      strategy: "all | canary | ring"
      percentage: 100
    rollback:
      strategy: "disable_flag | restore_previous_artifact"
      flag: "enable_plugin_name"
      trigger_conditions: []
    observability:
      dashboard: "dashboard-url"
      alert_group: "alert-group-name"
    status: "active | inactive | deprecated"
    registered_at: "YYYY-MM-DD"
    owner: "팀 이름"
```

## 등록 원칙

1. 플러그인 등록은 Stage C에서만 수행한다.
2. `ui_contract`와 `capability_contract`가 존재해야 등록 가능하다.
3. `feature_flag`가 false이면 마스터 UI에 노출하지 않는다.
4. `status: deprecated`인 플러그인은 90일 후 자동 제거 예정으로 표시한다.
5. 모든 플러그인은 rollback block을 가져야 하며, rollback flag는 등록된 primary feature_flag와 연결되어야 한다.

## 교차 파일 정합성 규칙

플러그인 등록은 `registry.yaml` 한 파일만 맞으면 끝나지 않는다. 아래 항목이 함께 일치해야 한다.

1. `plugin-registry/registry.yaml`
   - `ui_contract`, `capability_contract`, `stage_b_memory_ref`가 실제 파일을 가리켜야 한다.
2. `navigation/nav.yaml`
   - `plugin_id`, `route`, `feature_flag`가 registry와 충돌 없이 연결되어야 한다.
3. `catalog/domains.yaml`
   - 등록된 plugin이 도메인 카탈로그에 포함되어야 한다.
4. `feature-flags/flags.yaml`
   - registry와 navigation이 참조하는 flag가 존재해야 한다.
5. `observability/config.yaml`
   - registry의 dashboard/alert_group 참조가 실제 관측성 항목과 연결되어야 한다.
6. `operations/rollback-playbook.yaml`
   - registry의 rollback 정책이 실제 롤백 playbook과 일치해야 한다.

## 검증 명령

```bash
npm run validate:composition
npm run check:observability
npm run test:rollback
```

이 검증은 마스터 셸이 코드 내부를 읽지 않고도 조합 무결성을 유지하기 위한 코어 기준선이다.
