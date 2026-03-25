#!/usr/bin/env python3
"""
Generate a capability-scoped planning and learning brief.

Usage:
  python3 scripts/generate_capability_brief.py --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import CURRENT_WP_PATH, infer_goal_from_current_wp, load_yaml
from generate_benchmark_pack import BENCHMARK_PATH, build_benchmark_pack
from generate_packet_hierarchy import build_packet_hierarchy
from generate_starter_preset import build_starter_preset
from wp_scheduler import QUEUE_FILE


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS capability brief")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def build_capability_brief(goal: str, current_wp: dict) -> dict:
    queue = load_yaml(Path(QUEUE_FILE).resolve())
    hierarchy = build_packet_hierarchy(current_wp.get("id", ""), queue)
    preset = build_starter_preset(goal, current_wp)
    benchmark_catalog = load_yaml(BENCHMARK_PATH)
    benchmark_pack = build_benchmark_pack(goal, current_wp, benchmark_catalog)
    return {
        "schema_version": "1",
        "goal": goal,
        "capability": hierarchy.get("capability", {}),
        "current_packet": hierarchy.get("current_packet", {}),
        "next_ready_packets": hierarchy.get("ready_in_capability", [])[:3],
        "blocked_packets": hierarchy.get("blocked_in_capability", [])[:3],
        "planning_mode": preset.get("planning_mode", {}),
        "benchmark_focus": [
            {
                "id": item.get("id", ""),
                "title": item.get("title", ""),
                "score": item.get("score", 0),
            }
            for item in benchmark_pack.get("recommended_focuses", [])[:3]
        ],
        "study_points": [
            f"{item.get('id', '')} · {item.get('status', '')} · {item.get('goal', '')}"
            for item in hierarchy.get("learning_path", [])[:5]
        ],
        "commands": {
            "capability_brief_json": "python3 scripts/generate_capability_brief.py --json",
            "packet_hierarchy_json": "python3 scripts/generate_packet_hierarchy.py --json",
            "starter_preset_json": f"python3 scripts/generate_starter_preset.py --goal {goal} --json",
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    brief = build_capability_brief(goal, current_wp)

    if args.json:
        print(json.dumps(brief, indent=2, ensure_ascii=False))
        return

    print(yaml.dump(brief, allow_unicode=True, default_flow_style=False, sort_keys=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - CLI guard
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
