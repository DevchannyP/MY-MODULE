# Local Server Startup Guide

## 빠른 시작

```bash
npm start          # .env 자동 로드 후 http://localhost:3000 기동
```

`.env` 파일이 없으면 모든 플래그가 `false` 기본값으로 동작합니다.

---

## .env 플래그 제어 참조표

### 1. 도메인 기능 (released — 즉시 활성화 가능)

| 플래그 | 설명 | 활성화 후 엔드포인트 |
|--------|------|---------------------|
| `WOS_FLAG_ENABLE_TASK_MANAGEMENT=true` | 태스크 관리 | `GET /tasks` |
| `WOS_FLAG_BILLING_ENABLED=true` | 청구 도메인 | `GET /billing/invoices` |
| `WOS_FLAG_BILLING_INVOICE_ENABLED=true` | 인보이스 | `GET /billing/invoices` |
| `WOS_FLAG_BILLING_PAYMENT_ENABLED=true` | 결제 | `POST /billing/payments` |
| `WOS_FLAG_VIDEO_ENABLED=true` | 비디오 도메인 | `GET /videos` |
| `WOS_FLAG_VIDEO_UPLOAD_ENABLED=true` | 업로드 | `POST /videos` |

> 권한 헤더: `x-user-id: <id>`, `x-permissions: task:read,billing.read,video:read`

### 2. System OS 운영 포털 (internal — Stage E 완료)

| 플래그 | 설명 | 엔드포인트 |
|--------|------|-----------|
| `WOS_FLAG_SYSTEM_API_ENABLED=true` | System OS 전체 활성화 | `GET /api/v1/system/health` |
| `WOS_FLAG_SYSTEM_API_SSE_STREAM_ENABLED=true` | 실시간 이벤트 스트림 | `GET /api/v1/system/events` |
| `WOS_FLAG_SYSTEM_API_FLAG_TOGGLE_UI_ENABLED=true` | 플래그 토글 (system.admin 전용) | `PATCH /api/v1/system/flags/:id` |
| `WOS_FLAG_SYSTEM_API_ROLLBACK_UI_ENABLED=true` | 롤백 콘솔 (system.admin 전용) | `POST /api/v1/system/rollback/:domain` |

> System OS 관리자 호출: `x-permissions: system.admin`

주요 System OS 엔드포인트:

```
GET  /api/v1/system/health         # 서버 상태
GET  /api/v1/system/flags          # 전체 플래그 목록
GET  /api/v1/system/catalog        # 도메인 카탈로그
GET  /api/v1/system/quality-gate   # 품질 게이트 상태
GET  /api/v1/system/audit          # 감사 로그
GET  /api/v1/system/lifecycle      # 서버 라이프사이클 상태
```

**긴급 비활성화**: `WOS_FLAG_SYSTEM_API_ENABLED=false` → 서버 재시작

### 3. AI Harness (선택 — API 키 필요)

```bash
# .env에 추가 후 서버 재시작
HARNESS_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

키 없으면 NullProvider fallback으로 자동 동작 (모든 기능 정상, 추천만 null 반환).

검증:
```bash
curl -X POST http://localhost:3000/api/harness/prompt-recommendation \
  -H "content-type: application/json" \
  -d '{"mode":"Build","basePrompt":"next sprint planning"}'
# 키 있으면: "provider_id":"openai-responses"
# 키 없으면: "provider_id":"null-harness-provider","fallback_applied":true
```

---

## 헬스 프로브

```bash
curl http://localhost:3000/health    # 서버 준비 상태
curl http://localhost:3000/livez     # Liveness
curl http://localhost:3000/readyz    # Readiness
```

---

## 롤백

특정 플래그 비활성화: `.env`에서 해당 줄 주석 처리(`#`) 후 서버 재시작.

전체 초기화:
```bash
# .env에서 WOS_FLAG_ 라인 전부 주석 처리 → npm start
# 또는 .env 파일 삭제 → 안전한 기본값(전부 false)으로 기동
```

---

## DB 어댑터 선택 (Spiral 18)

```bash
# .env에 추가
DB_TYPE=sqlite     # 기본값 (파일 기반, 즉시 동작)
DB_TYPE=postgres   # PostgresTaskRepository 사용 (연결 설정 별도 필요)
```
