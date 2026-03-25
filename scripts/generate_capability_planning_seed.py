#!/usr/bin/env python3
"""
Generate editable planning seed sections for the current capability.

Usage:
  python3 scripts/generate_capability_planning_seed.py --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import CURRENT_WP_PATH, infer_goal_from_current_wp, load_yaml
from generate_capability_brief import build_capability_brief


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS capability planning seed")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def build_capability_planning_seed(goal: str, current_wp: dict) -> dict:
    brief = build_capability_brief(goal, current_wp)
    capability = brief.get("capability", {})
    planning_mode = brief.get("planning_mode", {})
    focus_titles = [item.get("title", "") for item in brief.get("benchmark_focus", []) if item.get("title")]
    next_ready = brief.get("next_ready_packets", [])
    blocked = brief.get("blocked_packets", [])
    return {
        "schema_version": "1",
        "goal": goal,
        "capability": capability,
        "planning_mode": planning_mode,
        "seed_sections": [
            {
                "id": "capability_goal",
                "value": f"{capability.get('name', 'capability')} 기준 현재 packet과 다음 ready packet을 하나의 실행 흐름으로 연결한다.",
            },
            {
                "id": "benchmark_focus",
                "value": ", ".join(focus_titles[:3]) or "benchmark focus를 적는다.",
            },
            {
                "id": "next_ready",
                "value": ", ".join(item.get("id", "") for item in next_ready[:3]) or "다음 ready packet을 적는다.",
            },
            {
                "id": "blocked_risk",
                "value": ", ".join(item.get("id", "") for item in blocked[:3]) or "현재 blocked packet 없음",
            },
        ],
        "commands": {
            "capability_seed_json": "python3 scripts/generate_capability_planning_seed.py --json",
            "capability_brief_json": "python3 scripts/generate_capability_brief.py --json",
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    payload = build_capability_planning_seed(goal, current_wp)

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
