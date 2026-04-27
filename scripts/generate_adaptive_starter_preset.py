#!/usr/bin/env python3
"""
Generate an adaptive starter preset by blending benchmark defaults with learned preset memory.

Usage:
  python3 scripts/generate_adaptive_starter_preset.py --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import CURRENT_WP_PATH, infer_goal_from_current_wp, load_yaml
from generate_blueprint_launch_deck import build_blueprint_launch_deck
from generate_learned_preset_memory import build_learned_preset_memory
from generate_starter_preset import (
    GOAL_TO_PLANNING_MODE,
    GOAL_TO_ROUTING_PROFILE,
    PLANNING_MODES_PATH,
    ROUTING_PATH,
    build_starter_preset,
    select_mode,
    select_routing,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS adaptive starter preset")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def build_adaptive_starter_preset(goal: str, current_wp: dict) -> dict:
    starter = build_starter_preset(goal, current_wp)
    learned = build_learned_preset_memory(goal, current_wp)
    blueprint = build_blueprint_launch_deck(goal, current_wp)
    planning_catalog = load_yaml(PLANNING_MODES_PATH)
    routing_catalog = load_yaml(ROUTING_PATH)

    signature = learned.get("recommended_signature", {})
    planning_mode_id = signature.get("planning_mode_id") or starter.get("planning_mode", {}).get("id") or GOAL_TO_PLANNING_MODE[goal]
    routing_profile_id = signature.get("routing_profile_id") or starter.get("routing_profile", {}).get("id") or GOAL_TO_ROUTING_PROFILE[goal]
    execution_template_id = signature.get("execution_template_id") or starter.get("execution_template_id", "")
    blueprint_id = signature.get("blueprint_id") or blueprint.get("blueprint", {}).get("id", "")

    mode = select_mode(planning_mode_id, planning_catalog)
    routing = select_routing(routing_profile_id, routing_catalog)
    learned_sections = {
        item.get("id", ""): item.get("value", "")
        for item in learned.get("learning_sections", [])
        if isinstance(item, dict) and item.get("id")
    }
    planning_sections = []
    for section in starter.get("planning_sections", []):
        section_id = section.get("id", "")
        planning_sections.append({
            "id": section_id,
            "value": learned_sections.get(section_id) or section.get("value", ""),
        })

    return {
        "schema_version": "1",
        "goal": goal,
        "source": "learned-memory" if learned.get("history_entries", 0) else "benchmark-default",
        "recommended_signature": {
            "planning_mode_id": planning_mode_id,
            "routing_profile_id": routing_profile_id,
            "execution_template_id": execution_template_id,
            "blueprint_id": blueprint_id,
        },
        "planning_mode": {
            "id": planning_mode_id,
            "title": mode.get("title", ""),
            "summary": mode.get("summary", ""),
        },
        "routing_profile": {
            "id": routing_profile_id,
            "objective": routing.get("objective", ""),
            "max_primary_files": routing.get("max_primary_files", 0),
            "max_secondary_files": routing.get("max_secondary_files", 0),
        },
        "execution_template_id": execution_template_id,
        "blueprint": blueprint.get("blueprint", {}),
        "planning_sections": planning_sections,
        "commands": {
            "adaptive_starter_json": "python3 scripts/generate_adaptive_starter_preset.py --json",
            "starter_preset_json": starter.get("commands", {}).get("starter_preset_json", ""),
            "learned_preset_memory_json": learned.get("commands", {}).get("learned_preset_memory_json", ""),
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    payload = build_adaptive_starter_preset(goal, current_wp)

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
