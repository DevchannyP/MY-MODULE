#!/usr/bin/env python3
"""
Validate harness trust-boundary and red-team security baseline.

이 스크립트는 실제 red-team 공격을 실행하지 않는다.
대신 보안 계약이 저장소 안에서 충분히 명시됐는지 검증한다.
"""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
TRUST_BOUNDARY = ROOT / "security" / "policies" / "trust-boundary.yaml"
REDTEAM = ROOT / "security" / "redteam" / "owasp-core.yaml"
HARNESS = ROOT / "requirements" / "harness-engineering.yaml"

TRUST_REQUIRED = [
    'version: "0.1.0"',
    "trusted_instruction_sources:",
    "untrusted_data_sources:",
    "invariants:",
    'id: "TB-001"',
    'classify_external_content_as: "data_only"',
    "ignore_imperative_content: true",
    "require_citations_for_external_claims: true",
]

REDTEAM_REQUIRED = [
    'version: "0.1.0"',
    "attacks:",
    'category: "prompt_injection"',
    'category: "system_prompt_exfiltration"',
    'category: "data_exfiltration"',
    'category: "tool_abuse"',
    'category: "excessive_agency"',
    "required_categories:",
]

HARNESS_REQUIRED = [
    "security_policy:",
    'trust_boundary_ref: "security/policies/trust-boundary.yaml"',
    'redteam_ref: "security/redteam/owasp-core.yaml"',
    "required_attacks:",
    '- "prompt_injection"',
]


def require_file(path: Path) -> str:
    if not path.exists():
        raise SystemExit(f"harness security validation FAIL: missing file -> {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def ensure_snippets(text: str, required: list[str], label: str) -> None:
    missing = [snippet for snippet in required if snippet not in text]
    if missing:
      raise SystemExit(
          f"harness security validation FAIL: {label} missing required sections -> "
          + ", ".join(missing)
      )


def main() -> None:
    trust_text = require_file(TRUST_BOUNDARY)
    redteam_text = require_file(REDTEAM)
    harness_text = require_file(HARNESS)

    ensure_snippets(trust_text, TRUST_REQUIRED, "trust-boundary")
    ensure_snippets(redteam_text, REDTEAM_REQUIRED, "redteam")
    ensure_snippets(harness_text, HARNESS_REQUIRED, "harness-engineering")

    print("harness security validation PASS")


if __name__ == "__main__":
    main()
