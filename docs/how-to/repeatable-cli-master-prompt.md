# 반복 실행용 CLI 마스터 프롬프트

이 문서는 채팅에 긴 규칙을 매번 복붙하지 않고, 같은 짧은 프롬프트로 현재 작업을 이어가기 위한 최소 입력 규약이다.

## 가장 짧은 사용법

```text
계속
```

위 한 단어를 입력하면 에이전트는 아래를 수행해야 한다.

1. `requirements/harness-engineering.yaml`을 읽는다.
2. `memory/checkpoint.yaml`, `memory/current-state.yaml`, `memory/current-wp.yaml`, `memory/wp-queue.yaml`, `memory/next-actions.yaml`을 읽는다.
3. 필요하면 `npm run session:bootstrap` 결과와 현재 Git 상태를 맞춘다.
4. 이번 요청을 Intake Packet으로 재구성한다.
5. 원인 분석 → 변경 포인트 최소화 → 작은 change set → 검증 순서로 진행한다.
6. 마지막에는 `원인 분석 / 변경 포인트 / 검증 결과 / 남은 리스크 / 다음 작업`만 간단히 보고한다.

## Cockpit-first handoff flow

handoff가 끊겼거나 후속 작업자가 이어받을 때는 먼저 아래 순서로 현재 관제면을 맞춘다.

```bash
npm run operator:cockpit -- --json
npm run session:bootstrap -- --json
npm run project:status
```

두 JSON 결과의 `handoff_summary`를 같은 기준으로 본다.

- `current_wp`: 지금 작업할 packet
- `next_wp`: 다음 queue 포인터
- `drift_status`: context lock과 실제 파일 차이
- `validation_state`: 검증/commit guard 준비 상태
- `evidence_state`: release evidence 또는 gate evidence 상태
- `next_command`: 가장 먼저 실행할 검증 명령

`handoff_summary.validation_state`가 `blocked`이면 코딩보다 preflight warning과 guard reason을 먼저 해소한다.

## 추천 짧은 프롬프트

```text
계속
검토
다음
```

- `계속`: 현재 상태 복구 후 가장 우선순위 높은 한 단계 실행
- `검토`: 지금 상태와 리스크만 보고
- `다음`: 현재 packet 완료 가능 여부를 확인하고 다음 packet 준비

## 복붙용 마스터 프롬프트

```text
이 저장소에서 AI harness operator로 동작하라.

반드시 아래 순서만 따른다.

1. 먼저 다음 파일을 읽어 현재 상태를 복구한다.
   - requirements/harness-engineering.yaml
   - memory/checkpoint.yaml
   - memory/current-state.yaml
   - memory/current-wp.yaml
   - memory/wp-queue.yaml
   - memory/next-actions.yaml
   - docs/explanation/ai-harness-upgrade-plan.md
2. 이번 요청을 intake packet으로 재구성한다.
   - goal
   - context
   - constraints
   - done_when
   - work_mode
   - verification
3. 바로 코딩하지 말고 먼저 원인 분석과 change point를 좁힌다.
4. 한 번에 하나의 작은 change set만 수행한다.
5. 변경 직후 관련 검증을 실행한다.
6. 마지막에는 아래 형식으로만 보고한다.
   - 원인 분석
   - 변경 포인트
   - 검증 결과
   - 남은 리스크
   - 다음 작업 1개

규칙:
- root memory가 canonical이다.
- 큰 리라이트 금지, 최소 변경 우선.
- 기존 사용자 변경을 되돌리지 말 것.
- 검증 실패 상태로 완료 선언하지 말 것.
- 필요한 문서와 테스트만 같이 맞출 것.
```

## 구조화 요청 템플릿

```text
목표:
맥락:
제약:
완료조건:
작업방식:
검증:
```

## 버그 수정 예시

```text
목표: 파일첨부 삭제 버그를 최소 변경으로 수정
맥락: fn_file_delete, fn_delete_temp_file_rows, /root/file_info 구조 사용
제약: 백엔드 delete 문은 건드리지 말 것, 인스턴스 추가 금지, 기존 저장 로직 유지
완료조건: 저장파일/미저장파일 혼합 상태에서 일부 삭제 후 저장해도 필수값 누락 없이 정상 저장
작업방식: 먼저 원인 분석, 그다음 변경 포인트만 제시, 마지막에 테스트 시나리오 3개 제시
검증: 삭제 후 file_info 재정렬, 저장 루프 통과, 재조회 결과 일치 확인
```

## 새 기능 예시

```text
목표: billing 도메인에 환불 흐름 추가
맥락: 기존 invoice/payment aggregate, contracts, controller, smoke test
제약: 기존 승인/정산 흐름 회귀 금지, 포트 경계 유지, 큰 리라이트 금지
완료조건: 환불 요청/조회/상태전이가 계약과 테스트까지 일치
작업방식: 요구사항 분해 후 계약 경계부터 잡고 구현
검증: unit, contract drift, interface smoke, 회귀 테스트
```
