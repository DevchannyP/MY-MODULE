# Worklog 템플릿

> **evidence vocabulary**: `contracts/harness/completion-report.schema.json` 과 동일한 필드명을 사용한다.  
> `verification_status` · `evidence_status` · `tests_run` · `tests_planned` · `risks` 는 완료 보고서와 handoff bundle이 그대로 읽는 canonical 필드다.

```markdown
# [날짜] - [Stage/WP] - [작업 제목]

**날짜**: YYYY-MM-DD
**Stage**: A | B | C | D | E | infra | meta
**모듈**: [module-id]
**wp_id**: WP-YYYY-MM-DD-NN
**실행자**: [이름 또는 자동화]
**verification_status**: PASS | PARTIAL_PASS | FAIL | PLANNED | NOT_RUN
**evidence_status**: observed | mixed | planned | not_observed
**risk_level**: LOW | MEDIUM | HIGH

## 수행 작업

- [작업 1]
- [작업 2]

## 생성/수정 파일 (change_points)

- `파일경로`: [변경 내용 요약] — status: changed | unchanged | planned

## verification (실행한 검증)

| 검증 항목 | status | evidence |
|----------|--------|----------|
| `npm run validate:requirements` | PASS | exit 0 |
| `npm test` | PASS | 816/816 |

## tests_planned (계획했으나 미실행)

| 검증 항목 | expected_result | 미실행 사유 |
|----------|----------------|------------|
| [항목명] | exit code 0 | NOT_RUN — 환경 미준비 |

_미실행 항목이 없으면 이 섹션을 제거한다._

## risks

- LOW: [리스크 설명] — rollback: [복구 방법]

## 다음 작업 (next_unlock)

- [ ] [다음에 해야 할 일]

## 차단 여부

차단 없음 | [차단 내용 및 해제 조건]
```
