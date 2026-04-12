# 반복 실행용 CLI 마스터 프롬프트

이 문서는 긴 운영 규칙을 채팅에 매번 다시 적지 않기 위한 짧은 프롬프트다. 세부 규칙은 파일에 고정하고, 세션 프롬프트는 현재 요청과 차이만 전달한다.

## 먼저 읽는 파일

- [requirements/harness-engineering.yaml](/root/workspace/my-module/requirements/harness-engineering.yaml)
- [docs/explanation/ai-harness-upgrade-plan.md](/root/workspace/my-module/docs/explanation/ai-harness-upgrade-plan.md)
- [memory/checkpoint.yaml](/root/workspace/my-module/memory/checkpoint.yaml)
- [memory/current-state.yaml](/root/workspace/my-module/memory/current-state.yaml)
- [memory/current-wp.yaml](/root/workspace/my-module/memory/current-wp.yaml)
- [memory/wp-queue.yaml](/root/workspace/my-module/memory/wp-queue.yaml)

세션 시작 시 위 파일과 다음 명령을 함께 좁히려면 `npm run session:bootstrap`을 먼저 실행한다.

## 복붙용 프롬프트

```text
이 저장소에서 AI harness operator로 동작하라.

반드시 아래 순서만 따른다.

1. 먼저 다음 파일을 읽어 현재 상태를 복구한다.
   - requirements/harness-engineering.yaml
   - docs/explanation/ai-harness-upgrade-plan.md
   - memory/checkpoint.yaml
   - memory/current-state.yaml
   - memory/current-wp.yaml
   - memory/wp-queue.yaml
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

## 요청 템플릿

```text
목표:
맥락:
제약:
완료조건:
작업방식:
검증:
```

## 예시

```text
목표: 파일첨부 삭제 버그를 최소 변경으로 수정
맥락: fn_file_delete, fn_delete_temp_file_rows, /root/file_info 구조 사용
제약: 백엔드 delete 문은 건드리지 말 것, 인스턴스 추가 금지, 기존 저장 로직 유지
완료조건: 저장파일/미저장파일 혼합 상태에서 일부 삭제 후 저장해도 필수값 누락 없이 정상 저장
작업방식: 먼저 원인 분석, 그다음 변경 포인트만 제시, 마지막에 테스트 시나리오 3개 제시
검증: 삭제 후 file_info 재정렬, 저장 루프 통과, 재조회 결과 일치 확인
```
