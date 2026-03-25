#!/usr/bin/env python3
"""
Generate a replay lens for bounded exception context usage.

Usage:
  python3 scripts/generate_exception_replay.py --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import CURRENT_WP_PATH, infer_goal_from_current_wp, load_yaml
from generate_exception_packet import build_exception_packet


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS exception replay lens")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def build_exception_replay(goal: str, current_wp: dict) -> dict:
    packet = build_exception_packet(goal, current_wp)
    allowed = packet.get("allowed_paths", [])
    promoted = packet.get("candidate_primary_promotions", [])
    return {
        "schema_version": "1",
        "goal": goal,
        "current_wp": {
            "id": current_wp.get("id", ""),
            "type": current_wp.get("type", ""),
            "stage": current_wp.get("stage", ""),
        },
        "allowed_exception_paths": allowed,
        "candidate_primary_promotions": promoted,
        "study_prompts": [
            "왜 primary read만으로 충분하지 않았는지 기록한다.",
            "허용된 exception path 중 실제로 다음부터 primary로 올릴 경로를 결정한다.",
            "exception read가 validation 또는 evidence에 어떤 차이를 만들었는지 적는다.",
        ],
        "next_actions": [
            "candidate primary promotion이 있으면 routing profile 또는 planning seed에서 우선 검토한다",
            "exception path가 반복되면 capability brief의 benchmark focus와 함께 재설계한다",
        ],
        "commands": {
            "exception_replay_json": "python3 scripts/generate_exception_replay.py --json",
            "exception_packet_json": "python3 scripts/generate_exception_packet.py --json",
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    payload = build_exception_replay(goal, current_wp)

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
