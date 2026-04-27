---
name: migration-export
description: 도메인 모듈 export/import/detach. 계약 호환성 검증 자동 포함.
---

## Export
node scripts/domain-migrate.js export {domain-id} --target {경로}

패키징:
- src/, tests/, contracts/, domain-spec.md
- memory/stageA~E/{domain}.yaml
- memory/reflections/{domain}-*.yaml
- 학습보고서 (worklog/reports/*{domain}*)
- manifest.yaml (계약 SHA-256 해시 포함)

## Import
node scripts/domain-migrate.js import {source} --into {project-root}

단계:
1. manifest.yaml 읽기
2. 계약 호환성 검증 (해시 비교)
3. domains/ 복사 + Stage B부터 재실행

## Detach
node scripts/domain-migrate.js detach {domain-id}

단계:
1. export 실행 (백업)
2. domains/{id}/ 삭제
3. domain-map.yaml / plugin-registry / nav.yaml에서 제거
4. 참조 도메인에 ACL 스텁 생성
5. Stage B 재실행으로 무결성 확인
