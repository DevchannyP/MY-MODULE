#!/usr/bin/env python3
"""
Branch protection policy validator.

이 스크립트는 GitHub 원격 설정을 직접 읽지 않는다.
대신 저장소 안에 있는 policy file 이 충분히 구체적인지 확인한다.

핵심 생각:
1. 원격 설정은 바뀔 수 있지만, 기준선 문서는 저장소에 남아야 한다.
2. 에이전트와 사람이 같은 기준을 보려면 체크 목록이 명시돼야 한다.
3. required checks 이름이 policy file 에 있어야 merge gate 가 흔들리지 않는다.
"""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
POLICY = ROOT / "artifacts/github/branch-protection-policy.yaml"

REQUIRED_SNIPPETS = [
    'version: "0.1.0"',
    'target_branch: "main"',
    "direct_push: false",
    "pull_request_required: true",
    "minimum_approvals: 1",
    "dismiss_stale_reviews: true",
    "force_push: false",
    "branch_deletion: false",
    '  - "lint"',
    '  - "test:contract"',
    '  - "type-check"',
    '  - "test"',
    '  - "scan:dependencies"',
    '  - "check:advisory-policy"',
    '  - "generate:release-evidence"',
]


def main() -> None:
    text = POLICY.read_text(encoding="utf-8")
    missing = [snippet for snippet in REQUIRED_SNIPPETS if snippet not in text]
    if missing:
        raise SystemExit(
            "branch protection policy validation FAIL: missing required sections -> "
            + ", ".join(missing)
        )

    print("branch protection policy validation PASS")


if __name__ == "__main__":
    main()
