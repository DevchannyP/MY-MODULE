# Module Template

이 디렉토리 구조를 복사하여 새 모듈을 생성한다.

```
[module-name]/
├── contract/
│   ├── openapi.yaml        # HTTP API 계약 (OpenAPI 3.x)
│   ├── events.schema.json  # 이벤트 계약 (AsyncAPI 또는 JSON Schema)
│   ├── ui-contract.yaml    # UI 계약 (ui-contract-reference.md 참조)
│   └── capability.yaml     # 기능 계약 (capability-contract-reference.md 참조)
├── src/
│   ├── domain/             # Domain Core: UI/DB/프레임워크/네트워크 모름
│   │   ├── entities/       # 도메인 엔티티
│   │   ├── value-objects/  # 값 객체
│   │   ├── services/       # 도메인 서비스 (순수 도메인 로직만)
│   │   └── events/         # 도메인 이벤트
│   ├── application/        # 애플리케이션 서비스 (유스케이스)
│   ├── infrastructure/     # DB, HTTP 클라이언트, 외부 연동
│   └── interface/          # API 컨트롤러, UI 어댑터
├── tests/
│   ├── unit/
│   ├── contract/
│   ├── integration/
│   └── e2e/
└── README.md               # 이 모듈의 도메인 역할 설명
```

## 생성 체크리스트

- [ ] `requirements/requirements.yaml`에 이 모듈 정보 입력
- [ ] Stage A 실행 (how-to/run-stage-a.md 참조)
- [ ] contract/ 4개 파일 생성
- [ ] `requirements/domain-map.yaml`에 등록
- [ ] `requirements/glossary.yaml`에 용어 추가
- [ ] Stage A memory 저장

## 절대 금지

- 다른 모듈의 `src/` 경로를 import하는 것
- `domain/` 레이어에서 DB/HTTP/프레임워크를 import하는 것
- contract 없이 모듈을 외부에 노출하는 것
