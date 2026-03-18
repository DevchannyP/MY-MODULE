# 롤백 및 Feature Flag 운영 방법

> **HOW** 중심 문서: 롤백과 Feature Flag를 어떻게 운영하는가?

## Feature Flag 운영

### Flag 추가

1. `requirements/requirements.yaml`의 `feature_flags` 섹션에 추가 (기본값 false).
2. `master-shell/feature-flags/flags.yaml`에 전역 등록.
3. 코드에서 flag 값을 읽어 기능 활성화 여부를 결정.

### Flag 활성화

단계적으로 활성화한다:
1. 내부 환경에서만 true로 설정하여 검증.
2. Stage D 품질 게이트 PASS 후 canary 롤아웃.
3. 전체 활성화는 모니터링 후 결정.
4. rollout 정책은 `master-shell/plugin-registry/registry.yaml`과 `master-shell/operations/rollback-playbook.yaml`을 함께 갱신한다.

### Flag 비활성화 (긴급)

이상 감지 시 즉시 flag를 false로 변경한다.
코드 배포 없이 기능을 비활성화할 수 있어야 한다.
긴급 비활성화 대상 flag 목록은 `master-shell/operations/rollback-playbook.yaml`을 기준으로 한다.

## 롤백 절차

### 사전 조건

- 이전 버전의 아티팩트가 아티팩트 저장소에 존재해야 한다.
- 롤백 절차가 Stage D에서 검증되어 있어야 한다.

### 롤백 단계

1. Feature Flag를 false로 설정 (즉각 효과).
2. `master-shell/plugin-registry/registry.yaml`의 plugin status가 `inactive` 유지 조건과 충돌하지 않는지 확인한다.
3. `master-shell/operations/rollback-playbook.yaml`의 disable_flags 목록을 순서대로 적용한다.
4. 이전 버전 아티팩트 또는 배포 단위를 확인한다.
5. `npm run test:rollback`으로 롤백 playbook 정합성을 검증한다.
6. `npm run check:observability` 기준 dashboard/alert_group으로 영향 지표를 확인한다.
7. `worklog/incidents.md`에 롤백 사유와 타임라인을 기록한다.

### 목표 시간

- RTO: 30분 이내 (nfr.yaml 참조)
- 롤백 자체는 5분 이내 완료

## 관련 문서

- docs/reference/observability-policy.md
- master-shell/operations/rollback-playbook.yaml
- requirements/nfr.yaml
- worklog/incidents.md
