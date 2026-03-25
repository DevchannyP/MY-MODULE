#!/usr/bin/env python3
"""
Generate routing adjustment suggestions from repeated exception candidates.

Usage:
  python3 scripts/generate_exception_routing_patch.py --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import CURRENT_WP_PATH, infer_goal_from_current_wp, load_yaml
from generate_exception_replay import build_exception_replay


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS exception routing patch")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def build_exception_routing_patch(goal: str, current_wp: dict) -> dict:
    replay = build_exception_replay(goal, current_wp)
    promote = replay.get("candidate_primary_promotions", [])
    allowed = replay.get("allowed_exception_paths", [])
    return {
        "schema_version": "1",
        "goal": goal,
        "routing_patch": {
            "promote_to_must_read": promote[:3],
            "keep_expand_if_needed": [item for item in allowed if item not in promote][:3],
            "review_later": allowed[3:6],
        },
        "rationale": [
            "candidate primary promotion 경로는 반복 exception을 줄이는 첫 후보입니다.",
            "promote하지 않은 allowed 경로는 expand_if_needed로 유지하는 편이 안전합니다.",
            "review_later 항목은 repeated signal이 더 쌓일 때만 routing 조정을 검토합니다.",
        ],
        "commands": {
            "exception_routing_json": "python3 scripts/generate_exception_routing_patch.py --json",
            "exception_replay_json": "python3 scripts/generate_exception_replay.py --json",
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    payload = build_exception_routing_patch(goal, current_wp)

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
