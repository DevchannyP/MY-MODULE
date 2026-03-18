# Domain App Template

여러 모듈을 조합하는 도메인 앱 구조.

```
[domain-name]/
├── [context-a]/           # 첫 번째 bounded context 모듈
│   └── (module-template 구조)
├── [context-b]/           # 두 번째 bounded context 모듈
│   └── (module-template 구조)
├── composition/
│   ├── domain-map.yaml    # 이 도메인 내 컨텍스트 간 관계
│   └── acl/               # Anti-Corruption Layer (외부 시스템 통합 시)
└── README.md              # 이 도메인이 해결하는 비즈니스 문제
```

## 조합 원칙

1. 동일 도메인 내 컨텍스트 간 통신: 이벤트 계약(events.schema.json)
2. 다른 도메인과의 통신: capability.yaml 계약
3. ACL 사용 시 ADR 필수

## 등록 절차

1. `requirements/domain-map.yaml`에 이 도메인 등록
2. 각 컨텍스트를 Stage A 실행
3. 컨텍스트 간 조합을 Stage B 실행
4. `master-shell/catalog/`에 도메인 목록 등록
