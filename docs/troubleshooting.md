# Troubleshooting

이 문서는 이 저장소에서 실제로 자주 확인해야 하는 실패 유형과 점검 순서를 정리한다.

## 1. `npm run validate:requirements` 실패

- 증상:
  요구사항 검증 스크립트가 FAIL 한다.
- 주로 볼 곳:
  `requirements/requirements.yaml`, `requirements/constraints.yaml`, 관련 참조 경로
- 직접 원인 후보:
  필수 section 누락, 경로 오탈자, requirement id 불일치
- 조치:
  요구사항 파일 자체를 먼저 맞춘 뒤, 해당 requirement를 소비하는 문서/스크립트 불일치를 확인한다.

## 2. `npm run validate:composition` 실패

- 증상:
  master shell 조합 검증이 FAIL 한다.
- 주로 볼 곳:
  `master-shell/plugin-registry/registry.yaml`
  `master-shell/navigation/*.yaml`
  `master-shell/catalog/*.yaml`
  `master-shell/feature-flags/*.yaml`
- 직접 원인 후보:
  plugin id, navigation id, feature flag 참조 불일치
- 조치:
  registry를 기준으로 catalog, navigation, flags를 교차 확인한다.

## 3. `npm run test:contract` 실패

- 증상:
  계약 드리프트 검증이 FAIL 한다.
- 주로 볼 곳:
  `contracts/`, `domains/**/contracts/`, `produced_by` 또는 consumer 참조
- 직접 원인 후보:
  구현 파일 이동 후 계약의 경로/이름을 갱신하지 않음
- 조치:
  이름을 바꾸기보다 참조를 현재 구현 경로에 맞춰 최소 수정한다.

## 4. `npm test` 또는 smoke 테스트 실패

- 증상:
  Node test runner 기준선이 FAIL 한다.
- 주로 볼 곳:
  최근 수정한 도메인과 해당 smoke/interface/application test
- 직접 원인 후보:
  import 경로 오탈자, 메서드명 불일치, fixture 기대값 불일치
- 조치:
  실패한 테스트의 진입점부터 production code까지 호출 경로를 따라가며 이름과 payload를 맞춘다.

## 5. `npm run test:e2e-smoke` 실패

- 증상:
  e2e smoke 또는 deployment smoke가 실패한다.
- [확실] 로컬 포트 바인딩 제한이 있는 샌드박스에서는 실패할 수 있다.
- 주로 볼 곳:
  `src/tests/smoke/`, `domains/**/tests/smoke/`, `scripts/run_deployment_smoke.js`
- 코드 원인 후보:
  route wiring 누락, controller/service 연결 불일치, feature flag 차단
- 환경 원인 후보:
  localhost bind 제한, 포트 충돌
- 조치:
  먼저 샌드박스 제약인지 확인하고, 아니면 wiring과 guardrail 경로를 본다.

## 6. `npm run project:status` 값이 비정상

- 증상:
  현재 Work Packet, context budget, readiness가 0 또는 비정상 값으로 나온다.
- 주로 볼 곳:
  `memory/current-wp.yaml`, `memory/wp-queue.yaml`, `scripts/project_status.js`
- [확실] 현재 기준으로 canonical context budget은 `memory/wp-queue.yaml`에 있을 수 있다.
- 조치:
  current packet surface와 canonical queue surface 중 어느 쪽이 truth source인지 먼저 맞춘다.

## 7. `npm run db:migrate:test` 관련 경고

- 증상:
  SQLite experimental warning이 보인다.
- [확실] 현재 기준선에서는 warning이어도 스키마 생성 PASS면 실패로 보지 않는다.
- 주로 볼 곳:
  `domains/productivity/task-tracking/src/infrastructure/SQLiteTaskRepository.js`
- 조치:
  warning 자체보다 스키마 생성과 CRUD 테스트 결과를 우선 확인한다.

## 8. 원격 배포/환경 관련 확인 필요 항목

- [확인 필요] GitHub deployment environment 실제 설정
- [확인 필요] 운영 비밀값, 환경 변수, 권한
- [확인 필요] 외부 서버나 WebLogic 같은 레거시 런타임 설정

위 항목은 코드 수정만으로 해결되지 않는다.

## 9. 빠른 기준선 명령

```bash
npm run validate:requirements
npm run lint
npm run validate:composition
npm run test:contract
npm test
npm run project:status
npm run db:migrate:test
npm run test:e2e-smoke
```
