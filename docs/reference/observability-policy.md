# 관측성 정책 참조

> **WHAT** 중심 문서: 관측성(Observability) 요구사항과 정책

## 세 가지 관측 기둥

### 메트릭 (Metrics)

RED 지표를 필수로 수집한다:
- **Rate**: 초당 요청 수
- **Error**: 오류율 (%)
- **Duration**: 응답 시간 (p50, p95, p99)

핵심 비즈니스 지표도 함께 수집한다 (도메인별로 정의).

### 분산 추적 (Tracing)

- 모든 서비스 간 호출에 trace-id를 전파한다.
- 기본 샘플링 정책: `0.1` (10%)
- 도구: OpenTelemetry 권장

### 구조화 로그 (Logging)

- JSON 형식 필수.
- 필수 필드: `timestamp`, `level`, `service`, `trace_id`, `span_id`, `message`.
- 민감정보(PII, 시크릿) 로그 기록 금지.

## SLO 및 알림

- SLO 위반 시 자동 알림이 발송되어야 한다.
- 코어 저장소 기준선에서는 `alert://workflow-os/...` 형식의 논리 채널 식별자를 사용한다.
- 알림 임계값: nfr.yaml의 가용성 지표 참조.

## 플러그인별 관측성

각 플러그인은 plugin-registry.yaml의 `observability` 섹션에 대시보드와 알림 그룹을 등록한다.

### 저장소 기준 URI 규약

- 대시보드 식별자: `dashboard://workflow-os/<plugin-or-domain>`
- 알림 채널 식별자: `alert://workflow-os/<plugin-or-team>`

이 규약은 실제 Grafana/DataDog, Slack/PagerDuty 연결 전까지 저장소 내부의 안정적인 참조 키로 사용한다.

## 검증 명령

```bash
npm run check:observability
```

이 명령은 최소 기준으로 다음을 검증한다.

1. plugin-registry의 dashboard/alert_group 참조가 실제 observability config와 일치하는지
2. RED 지표와 핵심 비즈니스 지표가 plugin별로 정의되어 있는지
3. alert channel, dashboard URL, sampling_rate, required_log_fields가 코어 기준선에 맞는지
