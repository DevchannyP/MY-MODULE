#!/usr/bin/env python3
"""
Generate a blueprint launch deck that ties goal, planning mode, routing profile,
and benchmark focus into a single starting surface.

Usage:
  python3 scripts/generate_blueprint_launch_deck.py --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import CURRENT_WP_PATH, infer_goal_from_current_wp, load_yaml
from generate_benchmark_pack import BENCHMARK_PATH, build_benchmark_pack
from generate_starter_preset import build_starter_preset


ROOT = Path(__file__).resolve().parent.parent
BLUEPRINTS_PATH = ROOT / "master-shell" / "catalog" / "project-blueprints.yaml"

GOAL_TO_BLUEPRINT_ID = {
    "plan-and-learn": "master-os-ai-studio",
    "module-extension": "domain-module-extension",
    "stateful-ops": "stateful-workflow-service",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS blueprint launch deck")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def select_blueprint(goal: str, catalog: dict) -> dict:
    blueprint_id = GOAL_TO_BLUEPRINT_ID.get(goal, "")
    for blueprint in catalog.get("blueprints", []):
        if isinstance(blueprint, dict) and blueprint.get("id") == blueprint_id:
            return blueprint
    return {}


def build_blueprint_launch_deck(goal: str, current_wp: dict) -> dict:
    blueprints_catalog = load_yaml(BLUEPRINTS_PATH)
    benchmark_catalog = load_yaml(BENCHMARK_PATH)
    blueprint = select_blueprint(goal, blueprints_catalog)
    starter_preset = build_starter_preset(goal, current_wp)
    benchmark_pack = build_benchmark_pack(goal, current_wp, benchmark_catalog)

    return {
        "schema_version": "1",
        "goal": goal,
        "current_wp": {
            "id": current_wp.get("id", ""),
            "type": current_wp.get("type", ""),
            "stage": current_wp.get("stage", ""),
            "status": current_wp.get("status", ""),
        },
        "blueprint": {
            "id": blueprint.get("id", ""),
            "name": blueprint.get("name", ""),
            "summary": blueprint.get("summary", ""),
            "when_to_use": blueprint.get("when_to_use", ""),
            "architecture_profile": blueprint.get("architecture_profile", ""),
        },
        "planning_mode": starter_preset.get("planning_mode", {}),
        "routing_profile": starter_preset.get("routing_profile", {}),
        "execution_template_id": starter_preset.get("execution_template_id", ""),
        "recommended_modules": blueprint.get("recommended_modules", [])[:4],
        "launch_sequence": blueprint.get("starter_sequence", [])[:4],
        "starter_deliverables": blueprint.get("starter_deliverables", [])[:4],
        "success_checks": blueprint.get("success_checks", [])[:3],
        "learning_tracks": blueprint.get("learning_tracks", [])[:3],
        "benchmark_focus": [
            {
                "id": item.get("id", ""),
                "title": item.get("title", ""),
                "score": item.get("score", 0),
            }
            for item in benchmark_pack.get("recommended_focuses", [])[:3]
        ],
        "commands": {
            "blueprint_launch_json": "python3 scripts/generate_blueprint_launch_deck.py --json",
            "starter_preset_json": starter_preset.get("commands", {}).get("starter_preset_json", ""),
            "benchmark_pack_json": benchmark_pack.get("commands", {}).get("benchmark_pack_json", ""),
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    payload = build_blueprint_launch_deck(goal, current_wp)

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
