## 목적

- 왜 이 변경이 필요한지 한 문장으로 적는다.

## 변경 내용

- 코드
- 문서
- memory / worklog

## 검증

- [ ] `npm run lint`
- [ ] `npm run test:contract`
- [ ] `npm run type-check`
- [ ] `npm test`
- [ ] `npm run scan:dependencies`
- [ ] `npm run check:advisory-policy`
- [ ] `npm run check:branch-protection-policy`
- [ ] `npm run generate:release-evidence`

## 코어 일관성 점검

- [ ] contract와 구현이 같이 맞춰졌다
- [ ] root `memory/current-state.yaml`, `memory/next-actions.yaml`, `memory/current-wp.yaml` 반영 여부를 확인했다
- [ ] `memory/project/*`는 레거시 호환이 필요한 경우에만 보조 갱신했다
- [ ] 필요한 ADR / worklog가 갱신됐다

## 위험과 롤백

- 위험:
- 롤백 방법:

## 다음 작업

- 다음 우선순위 작업:
