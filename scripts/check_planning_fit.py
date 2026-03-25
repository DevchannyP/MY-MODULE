#!/usr/bin/env python3
"""
Check whether the current planning/execution setup fits core constraints,
adapter compatibility rules, and token budget expectations.

Usage:
  python3 scripts/check_planning_fit.py --json
  python3 scripts/check_planning_fit.py --goal module-extension
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import (
    CONSTRAINTS_PATH,
    CURRENT_WP_PATH,
    GOAL_TO_PROFILE,
    ROUTING_PATH,
    build_bundle,
    infer_goal_from_current_wp,
    load_yaml,
)


ROOT = Path(__file__).resolve().parent.parent
ADAPTER_REGISTRY_PATH = ROOT / "master-shell" / "catalog" / "adapter-registry.yaml"
ADAPTER_COMPATIBILITY_PATH = ROOT / "master-shell" / "catalog" / "adapter-compatibility-matrix.yaml"

GOAL_TO_ARCH_PROFILE = {
    "plan-and-learn": "master-os-shell",
    "module-extension": "workflow-domain-module",
    "stateful-ops": "stateful-domain-module",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check Workflow OS planning fit")
    parser.add_argument("--goal", choices=sorted(GOAL_TO_PROFILE.keys()), default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--output", help="Optional output file")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def dedupe_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not isinstance(value, str) or not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def build_fit_report(goal: str, current_wp: dict, routing_catalog: dict, constraints: dict, adapter_registry: dict, compatibility_catalog: dict) -> dict:
    bundle = build_bundle(goal, current_wp, routing_catalog, constraints)
    profile_id = GOAL_TO_ARCH_PROFILE[goal]
    adapter_profiles = adapter_registry.get("adapter_profiles", []) if isinstance(adapter_registry.get("adapter_profiles", []), list) else []
    compatibility_profiles = compatibility_catalog.get("profiles", []) if isinstance(compatibility_catalog.get("profiles", []), list) else []
    selected_profile = next((item for item in adapter_profiles if item.get("id") == profile_id), {})
    compatibility_rule = next((item for item in compatibility_profiles if item.get("profile_id") == profile_id), {})
    selected_adapters = set(selected_profile.get("adapter_refs", []) if isinstance(selected_profile.get("adapter_refs", []), list) else [])
    required = compatibility_rule.get("required_adapters", []) if isinstance(compatibility_rule.get("required_adapters", []), list) else []
    forbidden = compatibility_rule.get("forbidden_adapters", []) if isinstance(compatibility_rule.get("forbidden_adapters", []), list) else []
    missing_required = [adapter_id for adapter_id in required if adapter_id not in selected_adapters]
    invalid_forbidden = [adapter_id for adapter_id in forbidden if adapter_id in selected_adapters]

    hard_constraints = constraints.get("hard_constraints", []) if isinstance(constraints.get("hard_constraints", []), list) else []
    hard_constraint_summary = [
        item.get("rule", "")
        for item in hard_constraints
        if isinstance(item, dict) and item.get("rule")
    ]

    primary_tokens = bundle["budget"]["primary"]["estimated_tokens"]
    total_tokens = bundle["budget"]["total_estimated_tokens"]
    scope_out = current_wp.get("scope_out", []) if isinstance(current_wp.get("scope_out", []), list) else []

    checks = [
        {
            "id": "core-protection",
            "label": "코어 보호 범위",
            "status": "pass" if scope_out else "warn",
            "detail": "scope_out이 선언되어 있습니다." if scope_out else "scope_out 선언을 추가하는 편이 안전합니다.",
        },
        {
            "id": "required-adapters",
            "label": "필수 어댑터 적합성",
            "status": "pass" if not missing_required else "warn",
            "detail": "필수 adapter가 모두 충족됩니다." if not missing_required else f"누락 adapter: {', '.join(missing_required)}",
        },
        {
            "id": "forbidden-adapters",
            "label": "금지 어댑터 충돌",
            "status": "pass" if not invalid_forbidden else "warn",
            "detail": "금지 adapter 충돌이 없습니다." if not invalid_forbidden else f"충돌 adapter: {', '.join(invalid_forbidden)}",
        },
        {
            "id": "constraint-coverage",
            "label": "제약/실패조건 커버리지",
            "status": "pass" if current_wp.get("constraints") and current_wp.get("fail_if") else "warn",
            "detail": "constraints와 fail_if가 모두 있습니다." if current_wp.get("constraints") and current_wp.get("fail_if") else "constraints와 fail_if를 함께 유지하는 편이 좋습니다.",
        },
        {
            "id": "token-budget",
            "label": "토큰 예산 적합성",
            "status": "pass" if primary_tokens <= 6000 and total_tokens <= 18000 else ("warn" if total_tokens <= 30000 else "risk"),
            "detail": f"primary {primary_tokens} tok / total {total_tokens} tok",
        },
        {
            "id": "completed-packet",
            "label": "현재 packet 상태",
            "status": "warn" if current_wp.get("status") == "completed" else "pass",
            "detail": "현재 packet이 completed라면 다음 packet 초안으로 넘기는 편이 좋습니다." if current_wp.get("status") == "completed" else "현재 packet이 아직 active 범위입니다.",
        },
    ]

    counts = {"pass": 0, "warn": 0, "risk": 0}
    for item in checks:
        counts[item["status"]] = counts.get(item["status"], 0) + 1

    return {
        "schema_version": "1",
        "goal": goal,
        "profile_id": profile_id,
        "routing_profile_id": bundle["profile_id"],
        "current_wp": {
            "id": current_wp.get("id", ""),
            "goal": current_wp.get("goal", ""),
            "type": current_wp.get("type", ""),
            "stage": current_wp.get("stage", ""),
            "status": current_wp.get("status", ""),
        },
        "checks": checks,
        "counts": counts,
        "bundle_budget": bundle["budget"],
        "required_adapters": required,
        "selected_adapters": dedupe_strings(list(selected_adapters)),
        "hard_constraints": hard_constraint_summary,
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    routing_catalog = load_yaml(ROUTING_PATH)
    constraints = load_yaml(CONSTRAINTS_PATH)
    adapter_registry = load_yaml(ADAPTER_REGISTRY_PATH)
    compatibility_catalog = load_yaml(ADAPTER_COMPATIBILITY_PATH)
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    report = build_fit_report(goal, current_wp, routing_catalog, constraints, adapter_registry, compatibility_catalog)

    if args.json:
        rendered = json.dumps(report, indent=2, ensure_ascii=False)
    else:
        rendered = yaml.dump(report, allow_unicode=True, default_flow_style=False, sort_keys=False)

    if args.output:
        output_path = Path(args.output).resolve()
        output_path.write_text(rendered, encoding="utf-8")
        print(str(output_path))
        return

    print(rendered)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - CLI guard
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
