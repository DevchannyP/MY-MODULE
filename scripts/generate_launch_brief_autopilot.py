#!/usr/bin/env python3
"""
Generate an autopilot launch brief recommendation from adaptive starter and kickoff evidence.

Usage:
  python3 scripts/generate_launch_brief_autopilot.py --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import CURRENT_WP_PATH, infer_goal_from_current_wp, load_yaml
from generate_adaptive_starter_preset import build_adaptive_starter_preset
from generate_blueprint_launch_deck import build_blueprint_launch_deck
from generate_kickoff_evidence_bundle import build_kickoff_evidence_bundle


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS launch brief autopilot")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def build_launch_brief_autopilot(goal: str, current_wp: dict) -> dict:
    adaptive = build_adaptive_starter_preset(goal, current_wp)
    blueprint = build_blueprint_launch_deck(goal, current_wp)
    evidence = build_kickoff_evidence_bundle(goal, current_wp)

    return {
        "schema_version": "1",
        "goal": goal,
        "source": adaptive.get("source", "benchmark-default"),
        "recommendation": {
            "blueprint_id": adaptive.get("recommended_signature", {}).get("blueprint_id", ""),
            "blueprint_name": adaptive.get("blueprint", {}).get("name", ""),
            "planning_mode_id": adaptive.get("recommended_signature", {}).get("planning_mode_id", ""),
            "routing_profile_id": adaptive.get("recommended_signature", {}).get("routing_profile_id", ""),
            "execution_template_id": adaptive.get("recommended_signature", {}).get("execution_template_id", ""),
        },
        "ready_gate": evidence.get("execution_readiness", {}),
        "start_now": evidence.get("kickoff_steps", [])[:5],
        "guardrails": [
            section.get("value", "")
            for section in adaptive.get("planning_sections", [])
            if section.get("id") in {"core_guardrail", "must_not_slip", "risk_and_observability", "operator_view"}
        ][:4],
        "starter_deliverables": blueprint.get("starter_deliverables", [])[:4],
        "commands": {
            "launch_brief_autopilot_json": "python3 scripts/generate_launch_brief_autopilot.py --json",
            "adaptive_starter_json": adaptive.get("commands", {}).get("adaptive_starter_json", ""),
            "kickoff_evidence_json": evidence.get("commands", {}).get("kickoff_evidence_json", ""),
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    payload = build_launch_brief_autopilot(goal, current_wp)

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
