# Review 템플릿

> **evidence vocabulary**: `contracts/harness/completion-report.schema.json` 과 동일한 필드명을 사용한다.  
> `verification_status` · `risk_level` · `verification[]` 은 handoff bundle이 직접 참조하는 canonical 필드다.

```markdown
# [날짜] - Review - [대상]

**날짜**: YYYY-MM-DD
**리뷰 대상**: [파일 경로 또는 Stage/WP-ID]
**리뷰어**: [이름]
**verification_status**: PASS | PARTIAL_PASS | FAIL
**risk_level**: LOW | MEDIUM | HIGH

## 체크리스트

### 계약 준수

- [ ] 모듈 간 직접 코드 참조 없음
- [ ] 도메인 코어에 UI/DB import 없음
- [ ] 계약 파일 4종 존재
- [ ] 계약 변경 시 Stage A 재실행됨

### 품질

- [ ] 품질 게이트 항목 모두 확인됨
- [ ] [확인 필요] 항목에 검증 절차 기재됨
- [ ] ADR 작성됨 (구조 결정 시)

### 문서

- [ ] memory 파일 갱신됨
- [ ] worklog 작성됨
- [ ] 도메인 언어 사용 (기술 용어 최소화)

## verification (실행한 검증)

| 검증 항목 | status | note |
|----------|--------|------|
| [항목명] | PASS | [확인 내용] |
| [항목명] | NOT_RUN | planned — [환경 미준비 등 이유] |

_`status` 값: PASS · PARTIAL_PASS · FAIL · PLANNED · NOT_RUN_

## risks

- [LOW | MEDIUM | HIGH]: [리스크 설명]

## 발견 사항

- [발견 1]: [심각도] — [수정 제안]

## 판정

PASS | FAIL

FAIL 이유: [이유]
```
