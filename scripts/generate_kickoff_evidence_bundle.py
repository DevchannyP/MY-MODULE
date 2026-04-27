#!/usr/bin/env python3
"""
Bundle kickoff evidence surfaces into one artifact.

Usage:
  python3 scripts/generate_kickoff_evidence_bundle.py --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import CURRENT_WP_PATH, infer_goal_from_current_wp, load_yaml
from generate_adaptive_starter_preset import build_adaptive_starter_preset
from generate_apply_outcome_scorecard import build_apply_outcome_scorecard
from generate_blueprint_launch_deck import build_blueprint_launch_deck
from generate_proven_kickoff_deck import build_proven_kickoff_deck


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS kickoff evidence bundle")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def build_kickoff_evidence_bundle(goal: str, current_wp: dict) -> dict:
    adaptive = build_adaptive_starter_preset(goal, current_wp)
    blueprint = build_blueprint_launch_deck(goal, current_wp)
    kickoff = build_proven_kickoff_deck(goal, current_wp)
    scorecard = build_apply_outcome_scorecard(goal, current_wp)

    return {
        "schema_version": "1",
        "goal": goal,
        "adaptive_signature": adaptive.get("recommended_signature", {}),
        "blueprint": blueprint.get("blueprint", {}),
        "kickoff_steps": kickoff.get("kickoff_steps", [])[:5],
        "starter_deliverables": kickoff.get("starter_deliverables", [])[:4],
        "execution_readiness": {
            "current_gate": scorecard.get("current_gate", "review"),
            "score": scorecard.get("score", 0),
        },
        "planning_sections": adaptive.get("planning_sections", [])[:5],
        "commands": {
            "kickoff_evidence_json": "python3 scripts/generate_kickoff_evidence_bundle.py --json",
            "adaptive_starter_json": adaptive.get("commands", {}).get("adaptive_starter_json", ""),
            "proven_kickoff_json": kickoff.get("commands", {}).get("proven_kickoff_json", ""),
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    payload = build_kickoff_evidence_bundle(goal, current_wp)

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
