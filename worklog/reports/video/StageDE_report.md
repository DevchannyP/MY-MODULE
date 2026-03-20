# 학습보고서 — video Stage D/E
날짜: 2026-03-21

## 기승 (What happened)
video 도메인 Stage A~E 완료. 적대적 테스트 7벡터, property-based 8케이스, GetTranscodeJobUseCase 7케이스 추가.
TranscodeJob.progressPercent undefined 버그 수정.

## 전 (What went wrong / Challenges)
- opts.progressPercent !== null 체크가 undefined와 null을 구분 못함 → nullish coalescing 수정
- GetTranscodeJobUseCase 소유권 강제(job.videoId !== cmd.videoId) 테스트 누락이었음

## 결 (What was learned)
- undefined !== null이 true인 점에서 발생하는 미묘한 버그 → 모든 optional 파라미터에 ?? 사용 권장
- 비디오 소유권 검증은 반드시 videoId + jobId 쌍으로 확인해야 함

## 행동 (Next actions)
- PRIVATE video ListVideos 필터 GAP-V001 ADR 작성
- 트랜스코딩 비동기 처리 외부 큐 연동 전략 수립
