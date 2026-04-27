# AI Harness Data Dictionary

이 문서는 반복 프롬프트 하네스에서 쓰는 핵심 용어를 고정한다. 사용자 요청, root memory, master UI, work packet이 같은 단어를 쓰게 하는 것이 목적이다.

## Terms

| 용어 | 정의 | 주 저장 위치 |
| --- | --- | --- |
| Intake Packet | 사용자 요청을 `goal`, `context`, `constraints`, `done_when`, `work_mode`, `verification`으로 구조화한 최소 실행 단위 | `requirements/harness-engineering.yaml`, 세션 응답 |
| Current Packet | 지금 닫고 있는 실제 작업 단위 | `memory/current-wp.yaml` |
| WP Queue | 다음 실행 후보 packet의 DAG 큐 | `memory/wp-queue.yaml` |
| Change Point | 결함 또는 요구사항을 닫기 위해 실제 수정이 필요한 최소 코드/문서 지점 | 세션 분석 결과 |
| Validation Loop | 수정 후 즉시 실행하는 확인 절차. 테스트, smoke, 상태 비교, 재조회 확인을 포함 | `package.json` scripts, `worklog/` |
| Current Lane | Backlog → Analysis → Build → Verify → Done 중 현재 packet이 머무는 UI 흐름 위치 | `scripts/generate-ui-home.js`, `artifacts/index.html`, `scripts/generate-mindmap.js` |
| Spiral Cycle | 한 번에 크게 끝내지 않고 분석 → 계획 → 실행 → 검증 → 학습을 반복하는 운영 모델 | `docs/explanation/ai-harness-upgrade-plan.md` |
| Harness Contract | 반복 프롬프트에서도 동일하게 적용되는 고정 규칙 묶음 | `requirements/harness-engineering.yaml` |
| Canonical State | 세션 재개 시 가장 먼저 믿어야 하는 현재 상태 | `memory/checkpoint.yaml`, `memory/current-state.yaml`, `memory/current-wp.yaml`, `memory/wp-queue.yaml` |
| Evidence | 완료를 주장하기 위한 검증 결과와 산출물 | `worklog/`, `artifacts/`, 테스트 로그 |
| Benchmark Signal | 외부 모범 사례에서 차용했지만 이 저장소 구조에 맞게 변환된 운영 원칙 | `docs/explanation/ai-harness-upgrade-plan.md` |
| Prompt Seed | 세션마다 복붙하는 짧은 프롬프트. 대표값은 `계속`, `검토`, `다음`이다 | `docs/how-to/repeatable-cli-master-prompt.md` |

## Canonical Files

| 파일 | 역할 |
| --- | --- |
| [requirements/harness-engineering.yaml](/root/workspace/my-module/requirements/harness-engineering.yaml) | 하네스 규칙, intake schema, 설계/검증 정책 |
| [docs/explanation/ai-harness-upgrade-plan.md](/root/workspace/my-module/docs/explanation/ai-harness-upgrade-plan.md) | 현재 프로젝트 기준 세분화 실행 계획 |
| [docs/how-to/repeatable-cli-master-prompt.md](/root/workspace/my-module/docs/how-to/repeatable-cli-master-prompt.md) | 세션용 짧은 반복 프롬프트 |
| [memory/current-state.yaml](/root/workspace/my-module/memory/current-state.yaml) | 실제 프로젝트 현재 capability 상태 |
| [memory/current-wp.yaml](/root/workspace/my-module/memory/current-wp.yaml) | 현재 닫힌/진행 packet 정보 |

## Naming Rules

- `goal`: 사용자가 원하는 결과를 한 문장으로 표현한다.
- `context`: 함수, 파일, 데이터 구조, 계약 경로처럼 실제 조사 범위를 적는다.
- `constraints`: 건드리면 안 되는 영역과 유지해야 하는 동작을 적는다.
- `done_when`: 사용자 관점 완료 조건만 적고 구현 수단은 적지 않는다.
- `work_mode`: 분석 순서와 보고 형식을 적는다.
- `verification`: 수정 뒤 반드시 관찰해야 하는 확인 항목을 적는다.
