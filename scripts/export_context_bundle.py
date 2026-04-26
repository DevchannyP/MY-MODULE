#!/usr/bin/env python3
"""
Export a minimal context bundle for the current planning/execution goal.

Usage:
  python3 scripts/export_context_bundle.py --goal plan-and-learn --json
  python3 scripts/export_context_bundle.py --goal module-extension --output bundle.yaml
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

import yaml


ROOT = Path(__file__).resolve().parent.parent
CURRENT_WP_PATH = ROOT / "memory" / "current-wp.yaml"
ROUTING_PATH = ROOT / "master-shell" / "catalog" / "context-routing-profiles.yaml"
CONSTRAINTS_PATH = ROOT / "requirements" / "constraints.yaml"

GOAL_TO_PROFILE = {
    "plan-and-learn": "plan-and-learn-routing",
    "module-extension": "module-extension-routing",
    "stateful-ops": "stateful-ops-routing",
}

DEFAULT_BUDGET_POLICY = {
    "primary_token_limit": 6000,
    "active_token_limit": 18000,
    "deferred_token_limit": 12000,
    "read_later_default": "excluded_from_active_context",
    "read_later_exception_requires": [
        "operator approval",
        "specific path",
        "reason",
        "expected command or file to inspect",
    ],
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export Workflow OS context bundle")
    parser.add_argument(
        "--goal",
        choices=sorted(GOAL_TO_PROFILE.keys()),
        default=None,
        help="Planning goal used to select a context routing profile",
    )
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--output", help="Optional output file path")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH), help="Override current-wp path")
    return parser.parse_args()


def load_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def ensure_list(value) -> list:
    return value if isinstance(value, list) else []


def dedupe_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not isinstance(value, str) or not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def estimate_tokens_from_bytes(byte_count: int) -> int:
    # 3 bytes/token: conservative estimate for Korean/English mixed content.
    if byte_count <= 0:
        return 0
    return max(1, round(byte_count / 3))


def collect_metric(relative_path: str) -> dict:
    target = ROOT / relative_path.rstrip("/")
    if not relative_path or not target.exists():
        return {
            "path": relative_path,
            "exists": False,
            "file_count": 0,
            "total_bytes": 0,
            "estimated_tokens": 0,
        }

    if target.is_file():
        total_bytes = target.stat().st_size
        return {
            "path": relative_path,
            "exists": True,
            "file_count": 1,
            "total_bytes": total_bytes,
            "estimated_tokens": estimate_tokens_from_bytes(total_bytes),
        }

    file_count = 0
    total_bytes = 0
    for base, _, files in os.walk(target):
        for file_name in files:
            file_count += 1
            try:
                total_bytes += (Path(base) / file_name).stat().st_size
            except OSError:
                continue
    return {
        "path": relative_path,
        "exists": True,
        "file_count": file_count,
        "total_bytes": total_bytes,
        "estimated_tokens": estimate_tokens_from_bytes(total_bytes),
    }


def summarize_metrics(paths: list[str]) -> dict:
    metrics = [collect_metric(path) for path in dedupe_strings(paths)]
    return {
        "paths": metrics,
        "file_count": sum(item["file_count"] for item in metrics),
        "total_bytes": sum(item["total_bytes"] for item in metrics),
        "estimated_tokens": sum(item["estimated_tokens"] for item in metrics),
    }


def budget_policy(routing_catalog: dict, profile: dict) -> dict:
    catalog_policy = routing_catalog.get("budget_policy") if isinstance(routing_catalog.get("budget_policy"), dict) else {}
    profile_policy = profile.get("budget_policy") if isinstance(profile.get("budget_policy"), dict) else {}
    merged = {**DEFAULT_BUDGET_POLICY, **catalog_policy, **profile_policy}
    return {
        "primary_token_limit": int(merged.get("primary_token_limit") or DEFAULT_BUDGET_POLICY["primary_token_limit"]),
        "active_token_limit": int(merged.get("active_token_limit") or DEFAULT_BUDGET_POLICY["active_token_limit"]),
        "deferred_token_limit": int(merged.get("deferred_token_limit") or DEFAULT_BUDGET_POLICY["deferred_token_limit"]),
        "read_later_default": str(merged.get("read_later_default") or DEFAULT_BUDGET_POLICY["read_later_default"]),
        "read_later_exception_requires": ensure_list(merged.get("read_later_exception_requires")) or DEFAULT_BUDGET_POLICY["read_later_exception_requires"],
    }


def risk_status(value: int, limit: int) -> str:
    if limit <= 0:
        return "unknown"
    if value <= limit:
        return "pass"
    if value <= limit * 1.5:
        return "warn"
    return "risk"


def build_budget_risk(first_summary: dict, next_summary: dict, later_summary: dict, policy: dict) -> dict:
    primary_tokens = first_summary["estimated_tokens"]
    active_tokens = first_summary["estimated_tokens"] + next_summary["estimated_tokens"]
    deferred_tokens = later_summary["estimated_tokens"]
    primary_status = risk_status(primary_tokens, policy["primary_token_limit"])
    active_status = risk_status(active_tokens, policy["active_token_limit"])
    deferred_status = risk_status(deferred_tokens, policy["deferred_token_limit"])
    statuses = [primary_status, active_status, deferred_status]
    overall = "risk" if "risk" in statuses else "warn" if "warn" in statuses else "pass"
    return {
        "status": overall,
        "primary_status": primary_status,
        "active_status": active_status,
        "deferred_status": deferred_status,
        "primary_estimated_tokens": primary_tokens,
        "active_estimated_tokens": active_tokens,
        "deferred_excluded_tokens": deferred_tokens,
        "thresholds": {
            "primary_token_limit": policy["primary_token_limit"],
            "active_token_limit": policy["active_token_limit"],
            "deferred_token_limit": policy["deferred_token_limit"],
        },
    }


def build_read_later_exceptions(later_summary: dict) -> list[dict]:
    exceptions: list[dict] = []
    for item in later_summary["paths"]:
        exceptions.append({
            "path": item["path"],
            "approval_required": True,
            "reason_required": True,
            "estimated_tokens": item["estimated_tokens"],
            "file_count": item["file_count"],
            "guidance": "read_later는 active context에서 제외한다. 필요한 경우 특정 path와 reason을 적어 승인 후 재읽기한다.",
        })
    return exceptions


def infer_goal_from_current_wp(current_wp: dict, requested_goal: str) -> str:
    if requested_goal:
        return requested_goal

    wp_type = current_wp.get("type")
    if wp_type in {"domain", "arch"}:
        return "module-extension"
    if wp_type in {"governance", "infra", "executor", "policy"}:
        return "stateful-ops"
    return "plan-and-learn"


def routing_profile(goal: str, routing_catalog: dict) -> dict:
    profiles = ensure_list(routing_catalog.get("profiles"))
    profile_id = GOAL_TO_PROFILE[goal]
    for profile in profiles:
        if profile.get("id") == profile_id:
            return profile
    raise ValueError(f"routing profile not found for goal: {goal}")


def build_bundle(goal: str, current_wp: dict, routing_catalog: dict, constraints: dict) -> dict:
    profile = routing_profile(goal, routing_catalog)
    policy = budget_policy(routing_catalog, profile)
    context_budget = current_wp.get("context_budget", {}) if isinstance(current_wp.get("context_budget", {}), dict) else {}
    read_first = dedupe_strings(ensure_list(profile.get("must_read")) + ensure_list(context_budget.get("tier_reads")))
    read_next = dedupe_strings(ensure_list(profile.get("expand_if_needed")) + ensure_list(context_budget.get("context_reads")))
    read_later = dedupe_strings(ensure_list(profile.get("defer_until_execution")) + ensure_list(context_budget.get("read_later")))
    protected_core = dedupe_strings(ensure_list(current_wp.get("scope_out")))
    hard_constraints = [
        item.get("rule", "")
        for item in ensure_list(constraints.get("hard_constraints"))
        if isinstance(item, dict) and item.get("rule")
    ]
    core_guardrails = dedupe_strings([
        *[item for item in hard_constraints if "core" in item.lower() or "master os" in item.lower() or "system os" in item.lower()],
        *[item for item in ensure_list(current_wp.get("fail_if")) if isinstance(item, str) and ("core" in item.lower() or "master os" in item.lower())],
    ])

    first_summary = summarize_metrics(read_first)
    next_summary = summarize_metrics(read_next)
    later_summary = summarize_metrics(read_later)
    budget_risk = build_budget_risk(first_summary, next_summary, later_summary, policy)

    return {
        "schema_version": "1",
        "goal": goal,
        "profile_id": profile.get("id"),
        "profile_objective": profile.get("objective"),
        "current_wp": {
            "id": current_wp.get("id", ""),
            "goal": current_wp.get("goal", ""),
            "type": current_wp.get("type", ""),
            "stage": current_wp.get("stage", ""),
        },
        "read_first": read_first,
        "read_next": read_next,
        "read_later": read_later,
        "read_later_policy": {
            "default": policy["read_later_default"],
            "exception_requires": policy["read_later_exception_requires"],
            "exceptions": build_read_later_exceptions(later_summary),
        },
        "protected_core": protected_core,
        "core_guardrails": core_guardrails,
        "budget": {
            "primary": {k: v for k, v in first_summary.items() if k != "paths"},
            "secondary": {k: v for k, v in next_summary.items() if k != "paths"},
            "deferred": {k: v for k, v in later_summary.items() if k != "paths"},
            "active_estimated_tokens": first_summary["estimated_tokens"] + next_summary["estimated_tokens"],
            "deferred_excluded_by_default": True,
            "total_estimated_tokens": first_summary["estimated_tokens"] + next_summary["estimated_tokens"] + later_summary["estimated_tokens"],
        },
        "budget_risk": budget_risk,
        "path_metrics": {
            "read_first": first_summary["paths"],
            "read_next": next_summary["paths"],
            "read_later": later_summary["paths"],
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    routing_catalog = load_yaml(ROUTING_PATH)
    constraints = load_yaml(CONSTRAINTS_PATH)
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    bundle = build_bundle(goal, current_wp, routing_catalog, constraints)

    if args.json:
        rendered = json.dumps(bundle, indent=2, ensure_ascii=False)
    else:
        rendered = yaml.dump(bundle, allow_unicode=True, default_flow_style=False, sort_keys=False)

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
