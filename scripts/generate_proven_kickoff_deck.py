#!/usr/bin/env python3
"""
Generate a proven kickoff deck by combining blueprint launch, learned preset memory,
benchmark focus, and token ROI.

Usage:
  python3 scripts/generate_proven_kickoff_deck.py --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import CURRENT_WP_PATH, infer_goal_from_current_wp, load_yaml
from generate_benchmark_pack import BENCHMARK_PATH, build_benchmark_pack
from generate_blueprint_launch_deck import build_blueprint_launch_deck
from generate_learned_preset_memory import build_learned_preset_memory
from generate_token_roi_report import build_token_roi_report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS proven kickoff deck")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def build_proven_kickoff_deck(goal: str, current_wp: dict) -> dict:
    benchmark_catalog = load_yaml(BENCHMARK_PATH)
    blueprint_launch = build_blueprint_launch_deck(goal, current_wp)
    learned_memory = build_learned_preset_memory(goal, current_wp)
    benchmark_pack = build_benchmark_pack(goal, current_wp, benchmark_catalog)
    token_roi = build_token_roi_report(goal, current_wp)

    kickoff_steps = [item.get("step", "") for item in blueprint_launch.get("launch_sequence", [])[:3]]
    kickoff_steps.extend(
        [f"learned preset 적용: {section.get('id', '')}" for section in learned_memory.get("learning_sections", [])[:2]]
    )

    return {
        "schema_version": "1",
        "goal": goal,
        "proven_start": {
            "blueprint_id": blueprint_launch.get("blueprint", {}).get("id", ""),
            "planning_mode_id": learned_memory.get("recommended_signature", {}).get("planning_mode_id", ""),
            "routing_profile_id": learned_memory.get("recommended_signature", {}).get("routing_profile_id", ""),
            "execution_template_id": learned_memory.get("recommended_signature", {}).get("execution_template_id", ""),
        },
        "kickoff_steps": [step for step in kickoff_steps if step][:5],
        "benchmark_focus": [
            {
                "id": item.get("id", ""),
                "title": item.get("title", ""),
                "score": item.get("score", 0),
            }
            for item in benchmark_pack.get("recommended_focuses", [])[:3]
        ],
        "context_budget": {
            "locked_tokens": token_roi.get("locked_tokens", 0),
            "estimated_savings_tokens": token_roi.get("estimated_savings_tokens", 0),
        },
        "starter_deliverables": blueprint_launch.get("starter_deliverables", [])[:4],
        "commands": {
            "proven_kickoff_json": "python3 scripts/generate_proven_kickoff_deck.py --json",
            "learned_preset_memory_json": learned_memory.get("commands", {}).get("learned_preset_memory_json", ""),
            "token_roi_json": token_roi.get("commands", {}).get("token_roi_json", ""),
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    payload = build_proven_kickoff_deck(goal, current_wp)

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
