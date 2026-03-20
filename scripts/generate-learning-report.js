#!/usr/bin/env node
'use strict';

/**
 * 학습보고서 디렉토리 구조 자동 생성기
 * 사용: node scripts/generate-learning-report.js {stage} {domain-id}
 * reporter 에이전트가 실제 내용을 채운다.
 */

const fs = require('node:fs');
const path = require('node:path');

const stage = process.argv[2];
const domainId = process.argv[3];

if (!stage || !domainId) {
  process.stderr.write('Usage: node scripts/generate-learning-report.js {stage} {domain-id}\n');
  process.exit(1);
}

const today = new Date().toISOString().split('T')[0];
const reportsDir = path.join(__dirname, '..', 'worklog', 'reports');
fs.mkdirSync(reportsDir, { recursive: true });

const existing = fs.readdirSync(reportsDir).filter(d => d.startsWith(today)).length;
const seq = String(existing + 1).padStart(3, '0');
const reportDir = path.join(reportsDir, `${today}_${seq}_${stage}_${domainId}`);

fs.mkdirSync(path.join(reportDir, 'snippets'), { recursive: true });
fs.mkdirSync(path.join(reportDir, 'diagrams'), { recursive: true });

const template = `# 학습 보고서: Stage ${stage.toUpperCase()} — ${domainId}

> 일자: ${today} | 순번: #${seq} | 작성: AI Agent
> Stage: ${stage} | 도메인: ${domainId}
> 게이트 결과: (reporter 에이전트가 채움)

---

## 기(起) — 배경과 문제 정의

(reporter 에이전트가 채움)

### 핵심 용어
| 용어 | 한글 | 의미 |
|------|------|------|

---

## 승(承) — 설계 결정

(reporter 에이전트가 채움)

---

## 전(轉) — 구현 (기초→심화)

### Level 1: 기초
\`\`\`javascript
// 왜 이렇게 하는가: (이유)
\`\`\`

### Level 2: 중급
\`\`\`javascript
// 실제 도메인 코드
\`\`\`

### Level 3: 심화
\`\`\`javascript
// 적대적 방어 / 엣지 케이스
\`\`\`

---

## 결(結) — 결과와 교훈

### 게이트 결과
| 항목 | 결과 | 비고 |
|------|------|------|

### 이번 Stage에서 배운 것
1.
2.
3.

### 다음 액션
(next-actions priority 1)
`;

fs.writeFileSync(path.join(reportDir, 'REPORT.md'), template, 'utf-8');
fs.writeFileSync(path.join(reportDir, 'snippets', '01-basic.js'), '// Level 1: 기초 — 패턴 자체를 설명\n', 'utf-8');
fs.writeFileSync(path.join(reportDir, 'snippets', '02-intermediate.js'), '// Level 2: 중급 — 실제 도메인 코드\n', 'utf-8');
fs.writeFileSync(path.join(reportDir, 'snippets', '03-advanced.js'), '// Level 3: 심화 — 적대적 방어\n', 'utf-8');

process.stdout.write(`✅ 보고서 디렉토리 생성: ${reportDir}\n`);
process.stdout.write('→ reporter 에이전트가 REPORT.md와 snippets를 채울 차례입니다.\n');
