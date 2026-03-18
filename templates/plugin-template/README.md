# Plugin Template

마스터 UI에 등록할 플러그인 구조.

```
[plugin-name]/
├── plugin.yaml             # 플러그인 메타데이터
├── ui/
│   ├── index.tsx           # 플러그인 진입점 (UI 컴포넌트)
│   └── routes.tsx          # 플러그인 내 라우트
└── README.md
```

## plugin.yaml

```yaml
id: "[plugin-id]"
name: "[도메인 언어로 된 이름]"
module_id: "[연결된 모듈 ID]"
version: "0.1.0"
entry_component: "index.tsx"
ui_contract: "../../contract/ui-contract.yaml"
capability_contract: "../../contract/capability.yaml"
```

## 플러그인 원칙

1. 플러그인은 마스터 UI에 `ui-contract.yaml`로만 등록된다.
2. 플러그인 UI는 capability.yaml에 정의된 기능만 호출한다.
3. 플러그인은 다른 플러그인의 코드를 직접 참조하지 않는다.
4. 화면 레이블은 도메인 언어로만 작성한다.

## 등록 절차

1. plugin.yaml 작성
2. master-shell/plugin-registry/registry.yaml에 등록 (Stage C)
3. feature_flag 설정 (기본값 false)
4. Stage D 품질 게이트 통과 후 활성화
