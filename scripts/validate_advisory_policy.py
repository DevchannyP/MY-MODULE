#!/usr/bin/env python3
"""
Advisory policy baseline validator.

이 스크립트는 온라인 advisory scan 자체를 실행하지 않는다.
대신 "나중에 연결할 정책이 충분히 구체적인가"를 확인한다.

왜 필요한가:
1. 네트워크가 없어도 정책 품질은 지금 검증할 수 있다.
2. 다른 프로젝트가 이 저장소 규칙을 그대로 가져갈 수 있다.
3. 오프라인 baseline 과 온라인 advisory 역할이 섞이지 않게 만든다.
"""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
POLICY = ROOT / "artifacts/advisory/advisory-policy.yaml"

REQUIRED_SNIPPETS = [
    'version: "0.1.0"',
    "offline_baseline:",
    'command: "npm run scan:dependencies"',
    "online_advisory:",
    'planned_command: "npm audit --omit=dev --audit-level=high"',
    "providers:",
    "blocking_policy:",
    "fail_on:",
    "warn_on:",
    "exceptions:",
    "required_fields:",
]


def main() -> None:
    text = POLICY.read_text(encoding="utf-8")
    missing = [snippet for snippet in REQUIRED_SNIPPETS if snippet not in text]
    if missing:
        raise SystemExit(
            "advisory policy validation FAIL: missing required sections -> "
            + ", ".join(missing)
        )

    print("advisory policy validation PASS")


if __name__ == "__main__":
    main()
