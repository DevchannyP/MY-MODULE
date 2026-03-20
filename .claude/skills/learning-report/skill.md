---
name: learning-report
description: Stage 완료 시 기승전결 학습보고서 자동 생성. 기초→심화 코드 스니펫 포함.
---

## 파일 경로 규칙
worklog/reports/{YYYY-MM-DD}_{NNN}_{stage}_{domain}/
  REPORT.md
  snippets/01-basic.js
  snippets/02-intermediate.js
  snippets/03-advanced.js

NNN: 해당 날짜 내 기존 보고서 수 + 1 (3자리 zero-pad)

## REPORT.md 구조 (기승전결 4막)

### 기(起) — 배경
- 이 Stage가 해결한 문제
- requirements.yaml 기반 요구사항 요약
- 핵심 용어 표 (term | 한글 | 의미)

### 승(承) — 설계 결정
- 아키텍처 결정 + 대안 대비 이유
- 핵심 불변조건 (INV 목록 + enforcement 레이어)
- ADR 링크

### 전(轉) — 구현 (코드 스니펫 3단계)
- Level 1 기초: 순수 JS로 패턴 자체 설명 (한글 주석 필수)
- Level 2 중급: 실제 도메인 코드 발췌
- Level 3 심화: 적대적 방어 또는 엣지 케이스 처리

### 결(結) — 결과와 교훈
- 게이트 결과 표
- 이번 Stage에서 배운 것 3가지
- 재사용 가능한 패턴
- Reflexion 참조 (있을 경우)
- 다음 액션

## 코드 스니펫 규칙
- 모든 스니펫에 한글 주석 필수 ("// 이 코드는 ~를 위해 존재한다")
- node snippets/01-basic.js 로 실행 가능해야 함
- 기초 스니펫은 외부 require 없이 작동
