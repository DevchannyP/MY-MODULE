#!/usr/bin/env python3
"""
Generate a merged routing learning ledger from exception and ROI routing signals.

Usage:
  python3 scripts/generate_routing_learning_ledger.py --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import CURRENT_WP_PATH, infer_goal_from_current_wp, load_yaml
from generate_adaptive_starter_preset import build_adaptive_starter_preset
from generate_exception_routing_patch import build_exception_routing_patch
from generate_token_roi_routing_patch import build_token_roi_routing_patch


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS routing learning ledger")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def unique_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not isinstance(value, str) or not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def build_routing_learning_ledger(goal: str, current_wp: dict) -> dict:
    adaptive = build_adaptive_starter_preset(goal, current_wp)
    exception_patch = build_exception_routing_patch(goal, current_wp)
    roi_patch = build_token_roi_routing_patch(goal, current_wp)

    promote_to_primary = unique_strings(
        (exception_patch.get("routing_patch", {}).get("promote_to_must_read", []) or [])
        + (roi_patch.get("routing_patch", {}).get("promote_to_primary", []) or [])
    )
    keep_secondary = unique_strings(
        (exception_patch.get("routing_patch", {}).get("keep_expand_if_needed", []) or [])
        + (roi_patch.get("routing_patch", {}).get("keep_secondary", []) or [])
    )
    move_to_deferred = unique_strings(roi_patch.get("routing_patch", {}).get("move_to_deferred", []) or [])

    return {
        "schema_version": "1",
        "goal": goal,
        "routing_profile_id": adaptive.get("recommended_signature", {}).get("routing_profile_id", ""),
        "routing_learning": {
            "promote_to_primary": promote_to_primary[:5],
            "keep_secondary": keep_secondary[:5],
            "move_to_deferred": move_to_deferred[:5],
        },
        "estimated_savings_tokens": roi_patch.get("estimated_savings_tokens", 0),
        "notes": [
            "exception routing과 token ROI patch를 한 장의 canonical routing 메모리로 합칩니다.",
            "promote_to_primary는 반복 exception과 ROI가 동시에 지지하는 경로를 우선합니다.",
            "move_to_deferred는 token 절감이 큰 경로부터 우선 검토합니다.",
        ],
        "commands": {
            "routing_learning_ledger_json": "python3 scripts/generate_routing_learning_ledger.py --json",
            "exception_routing_json": exception_patch.get("commands", {}).get("exception_routing_json", ""),
            "token_roi_routing_json": roi_patch.get("commands", {}).get("token_roi_routing_json", ""),
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    payload = build_routing_learning_ledger(goal, current_wp)

    if args.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return

    print(yaml.dump(payload, allow_unicode=True, default_flow_style=False, sort_keys=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - CLI guard
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
